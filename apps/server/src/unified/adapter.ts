import {
  assertNever,
  type ThreadConversationState,
  type UserInputRequest,
  UserInputRequestSchema,
} from "@farfield/protocol";
import {
  JsonValueSchema,
  UnifiedFeatureMatrixSchema,
  UNIFIED_COMMAND_KINDS,
  UNIFIED_FEATURE_IDS,
  type JsonValue,
  type UnifiedCommand,
  type UnifiedCommandKind,
  type UnifiedCommandResult,
  type UnifiedFeatureAvailability,
  type UnifiedFeatureId,
  type UnifiedFeatureMatrix,
  type UnifiedFeatureUnavailableReason,
  type UnifiedItem,
  type UnifiedProviderId,
  type UnifiedThread,
  type UnifiedThreadSummary,
} from "@farfield/unified-surface";
import type { AgentAdapter } from "../agents/types.js";

type UnifiedCommandByKind<K extends UnifiedCommandKind> = Extract<
  UnifiedCommand,
  { kind: K }
>;
type UnifiedCommandResultByKind<K extends UnifiedCommandKind> = Extract<
  UnifiedCommandResult,
  { kind: K }
>;

function maybeParseUserInputRequest(
  request: ThreadConversationState["requests"][number],
): UserInputRequest | null {
  const result = UserInputRequestSchema.safeParse(request);
  if (!result.success) {
    return null;
  }
  return result.data;
}

type UnifiedCommandHandler<K extends UnifiedCommandKind> = (
  command: UnifiedCommandByKind<K>,
) => Promise<UnifiedCommandResultByKind<K>>;

export type UnifiedCommandHandlerTable = {
  [K in UnifiedCommandKind]: UnifiedCommandHandler<K>;
};

export const FEATURE_ID_BY_COMMAND_KIND: Record<
  UnifiedCommandKind,
  UnifiedFeatureId
> = {
  listThreads: "listThreads",
  createThread: "createThread",
  readThread: "readThread",
  sendMessage: "sendMessage",
  interrupt: "interrupt",
  listModels: "listModels",
  listCollaborationModes: "listCollaborationModes",
  setCollaborationMode: "setCollaborationMode",
  submitUserInput: "submitUserInput",
  readLiveState: "readLiveState",
  readStreamEvents: "readStreamEvents",
  listProjectDirectories: "listProjectDirectories",
};

const PROVIDER_FEATURE_SUPPORT: Record<
  UnifiedProviderId,
  Record<UnifiedFeatureId, boolean>
> = {
  codex: {
    listThreads: true,
    createThread: true,
    readThread: true,
    sendMessage: true,
    interrupt: true,
    listModels: true,
    listCollaborationModes: true,
    setCollaborationMode: true,
    submitUserInput: true,
    readLiveState: true,
    readStreamEvents: true,
    listProjectDirectories: false,
  },
  opencode: {
    listThreads: true,
    createThread: true,
    readThread: true,
    sendMessage: true,
    interrupt: true,
    listModels: false,
    listCollaborationModes: false,
    setCollaborationMode: false,
    submitUserInput: false,
    readLiveState: false,
    readStreamEvents: false,
    listProjectDirectories: true,
  },
};

export class UnifiedBackendFeatureError extends Error {
  public readonly provider: UnifiedProviderId;
  public readonly featureId: UnifiedFeatureId;
  public readonly reason: UnifiedFeatureUnavailableReason;

  public constructor(
    provider: UnifiedProviderId,
    featureId: UnifiedFeatureId,
    reason: UnifiedFeatureUnavailableReason,
    detail?: string,
  ) {
    super(
      detail ??
        `Feature ${featureId} is unavailable for ${provider} (${reason})`,
    );
    this.name = "UnifiedBackendFeatureError";
    this.provider = provider;
    this.featureId = featureId;
    this.reason = reason;
  }
}

export interface UnifiedProviderAdapter {
  readonly provider: UnifiedProviderId;
  readonly handlers: UnifiedCommandHandlerTable;

  getFeatureAvailability(): Record<
    UnifiedFeatureId,
    UnifiedFeatureAvailability
  >;
  execute<K extends UnifiedCommandKind>(
    command: UnifiedCommandByKind<K>,
  ): Promise<UnifiedCommandResultByKind<K>>;
}

export class AgentUnifiedProviderAdapter implements UnifiedProviderAdapter {
  public readonly provider: UnifiedProviderId;
  public readonly handlers: UnifiedCommandHandlerTable;

  private readonly adapter: AgentAdapter;

  public constructor(provider: UnifiedProviderId, adapter: AgentAdapter) {
    this.provider = provider;
    this.adapter = adapter;
    this.handlers = createHandlerTable(provider, adapter);
  }

  public getFeatureAvailability(): Record<
    UnifiedFeatureId,
    UnifiedFeatureAvailability
  > {
    return buildProviderFeatureAvailability(this.provider, this.adapter);
  }

  public async execute<K extends UnifiedCommandKind>(
    command: UnifiedCommandByKind<K>,
  ): Promise<UnifiedCommandResultByKind<K>> {
    if (command.provider !== this.provider) {
      throw new Error(
        `Command provider ${command.provider} does not match adapter ${this.provider}`,
      );
    }

    const featureId = FEATURE_ID_BY_COMMAND_KIND[command.kind];
    const availability = this.getFeatureAvailability()[featureId];
    if (!availability) {
      throw new Error(`Missing feature availability for ${featureId}`);
    }

    if (availability.status === "unavailable") {
      throw new UnifiedBackendFeatureError(
        this.provider,
        featureId,
        availability.reason,
        availability.detail,
      );
    }

    return this.runCommand(command);
  }

  private runCommand<K extends UnifiedCommandKind>(
    command: UnifiedCommandByKind<K>,
  ): Promise<UnifiedCommandResultByKind<K>> {
    return this.handlers[command.kind](command);
  }
}

export function createUnifiedProviderAdapters(
  adapters: Record<UnifiedProviderId, AgentAdapter | null>,
): Record<UnifiedProviderId, UnifiedProviderAdapter | null> {
  return {
    codex: adapters.codex
      ? new AgentUnifiedProviderAdapter("codex", adapters.codex)
      : null,
    opencode: adapters.opencode
      ? new AgentUnifiedProviderAdapter("opencode", adapters.opencode)
      : null,
  };
}

export function buildUnifiedFeatureMatrix(
  adapters: Record<UnifiedProviderId, AgentAdapter | null>,
): UnifiedFeatureMatrix {
  const matrix: UnifiedFeatureMatrix = {
    codex: buildProviderFeatureAvailability("codex", adapters.codex),
    opencode: buildProviderFeatureAvailability("opencode", adapters.opencode),
  };

  UnifiedFeatureMatrixSchema.parse(matrix);
  return matrix;
}

function createHandlerTable(
  provider: UnifiedProviderId,
  adapter: AgentAdapter,
): UnifiedCommandHandlerTable {
  return {
    listThreads: async (command) => {
      const result = await adapter.listThreads({
        limit: command.limit,
        archived: command.archived,
        all: command.all,
        maxPages: command.maxPages,
        cursor: command.cursor ?? null,
      });

      return {
        kind: "listThreads",
        data: result.data.map((thread) => mapThreadSummary(provider, thread)),
        nextCursor: result.nextCursor ?? null,
        ...(typeof result.pages === "number" ? { pages: result.pages } : {}),
        ...(typeof result.truncated === "boolean"
          ? { truncated: result.truncated }
          : {}),
      };
    },

    createThread: async (command) => {
      const created = await adapter.createThread({
        ...(command.cwd ? { cwd: command.cwd } : {}),
        ...(command.model ? { model: command.model } : {}),
        ...(command.modelProvider
          ? { modelProvider: command.modelProvider }
          : {}),
        ...(command.personality ? { personality: command.personality } : {}),
        ...(command.sandbox ? { sandbox: command.sandbox } : {}),
        ...(command.approvalPolicy
          ? { approvalPolicy: command.approvalPolicy }
          : {}),
        ...(typeof command.ephemeral === "boolean"
          ? { ephemeral: command.ephemeral }
          : {}),
      });

      const loaded = await adapter.readThread({
        threadId: created.threadId,
        includeTurns: false,
      });

      return {
        kind: "createThread",
        threadId: created.threadId,
        thread: mapThread(provider, loaded.thread),
      };
    },

    readThread: async (command) => {
      const result = await adapter.readThread({
        threadId: command.threadId,
        includeTurns: command.includeTurns,
      });

      return {
        kind: "readThread",
        thread: mapThread(provider, result.thread),
      };
    },

    sendMessage: async (command) => {
      await adapter.sendMessage({
        threadId: command.threadId,
        text: command.text,
        ...(command.ownerClientId
          ? { ownerClientId: command.ownerClientId }
          : {}),
        ...(command.cwd ? { cwd: command.cwd } : {}),
        ...(typeof command.isSteering === "boolean"
          ? { isSteering: command.isSteering }
          : {}),
      });

      return {
        kind: "sendMessage",
      };
    },

    interrupt: async (command) => {
      await adapter.interrupt({
        threadId: command.threadId,
        ...(command.ownerClientId
          ? { ownerClientId: command.ownerClientId }
          : {}),
      });

      return {
        kind: "interrupt",
      };
    },

    listModels: async (command) => {
      if (!adapter.listModels) {
        throw new UnifiedBackendFeatureError(
          provider,
          "listModels",
          "unsupportedByProvider",
        );
      }

      const result = await adapter.listModels(command.limit);
      return {
        kind: "listModels",
        data: result.data.map((model) => ({
          id: model.id,
          displayName: model.displayName,
          description: model.description,
          defaultReasoningEffort: model.defaultReasoningEffort ?? null,
          supportedReasoningEfforts: model.supportedReasoningEfforts.map(
            (entry) => entry.reasoningEffort,
          ),
          hidden: model.hidden ?? false,
          isDefault: model.isDefault ?? false,
        })),
      };
    },

    listCollaborationModes: async () => {
      if (!adapter.listCollaborationModes) {
        throw new UnifiedBackendFeatureError(
          provider,
          "listCollaborationModes",
          "unsupportedByProvider",
        );
      }

      const result = await adapter.listCollaborationModes();
      return {
        kind: "listCollaborationModes",
        data: result.data.map((mode) => ({
          name: mode.name,
          mode: mode.mode ?? "default",
          ...(mode.model !== undefined ? { model: mode.model } : {}),
          ...(mode.reasoning_effort !== undefined
            ? { reasoningEffort: mode.reasoning_effort }
            : {}),
          ...(mode.developer_instructions !== undefined
            ? { developerInstructions: mode.developer_instructions }
            : {}),
        })),
      };
    },

    setCollaborationMode: async (command) => {
      if (!adapter.setCollaborationMode) {
        throw new UnifiedBackendFeatureError(
          provider,
          "setCollaborationMode",
          "unsupportedByProvider",
        );
      }

      const result = await adapter.setCollaborationMode({
        threadId: command.threadId,
        ...(command.ownerClientId
          ? { ownerClientId: command.ownerClientId }
          : {}),
        collaborationMode: {
          mode: command.collaborationMode.mode,
          settings: {
            ...(command.collaborationMode.settings.model !== undefined
              ? { model: command.collaborationMode.settings.model }
              : {}),
            ...(command.collaborationMode.settings.reasoningEffort !== undefined
              ? {
                  reasoning_effort:
                    command.collaborationMode.settings.reasoningEffort,
                }
              : {}),
            ...(command.collaborationMode.settings.developerInstructions !==
            undefined
              ? {
                  developer_instructions:
                    command.collaborationMode.settings.developerInstructions,
                }
              : {}),
          },
        },
      });

      return {
        kind: "setCollaborationMode",
        ownerClientId: result.ownerClientId,
      };
    },

    submitUserInput: async (command) => {
      if (!adapter.submitUserInput) {
        throw new UnifiedBackendFeatureError(
          provider,
          "submitUserInput",
          "unsupportedByProvider",
        );
      }

      const result = await adapter.submitUserInput({
        threadId: command.threadId,
        ...(command.ownerClientId
          ? { ownerClientId: command.ownerClientId }
          : {}),
        requestId: command.requestId,
        response: command.response,
      });

      return {
        kind: "submitUserInput",
        ownerClientId: result.ownerClientId,
        requestId: result.requestId,
      };
    },

    readLiveState: async (command) => {
      if (!adapter.readLiveState) {
        throw new UnifiedBackendFeatureError(
          provider,
          "readLiveState",
          "unsupportedByProvider",
        );
      }

      const liveState = await adapter.readLiveState(command.threadId);
      return {
        kind: "readLiveState",
        threadId: command.threadId,
        ownerClientId: liveState.ownerClientId,
        conversationState: liveState.conversationState
          ? mapThread(provider, liveState.conversationState)
          : null,
        ...(liveState.liveStateError
          ? { liveStateError: liveState.liveStateError }
          : {}),
      };
    },

    readStreamEvents: async (command) => {
      if (!adapter.readStreamEvents) {
        throw new UnifiedBackendFeatureError(
          provider,
          "readStreamEvents",
          "unsupportedByProvider",
        );
      }

      const streamEvents = await adapter.readStreamEvents(
        command.threadId,
        command.limit,
      );
      return {
        kind: "readStreamEvents",
        threadId: command.threadId,
        ownerClientId: streamEvents.ownerClientId,
        events: streamEvents.events.map((event) =>
          jsonValueFromString(JSON.stringify(event)),
        ),
      };
    },

    listProjectDirectories: async () => {
      if (!adapter.listProjectDirectories) {
        throw new UnifiedBackendFeatureError(
          provider,
          "listProjectDirectories",
          "unsupportedByProvider",
        );
      }

      const directories = await adapter.listProjectDirectories();
      return {
        kind: "listProjectDirectories",
        directories,
      };
    },
  };
}

function buildProviderFeatureAvailability(
  provider: UnifiedProviderId,
  adapter: AgentAdapter | null,
): Record<UnifiedFeatureId, UnifiedFeatureAvailability> {
  const availability = {} as Record<
    UnifiedFeatureId,
    UnifiedFeatureAvailability
  >;

  for (const featureId of UNIFIED_FEATURE_IDS) {
    availability[featureId] = resolveFeatureAvailability(
      provider,
      adapter,
      featureId,
    );
  }

  return availability;
}

function resolveFeatureAvailability(
  provider: UnifiedProviderId,
  adapter: AgentAdapter | null,
  featureId: UnifiedFeatureId,
): UnifiedFeatureAvailability {
  if (!adapter || !adapter.isEnabled()) {
    return unavailable("providerDisabled");
  }

  if (!adapter.isConnected()) {
    return unavailable("providerDisconnected");
  }

  if (!PROVIDER_FEATURE_SUPPORT[provider][featureId]) {
    return unavailable("unsupportedByProvider");
  }

  return {
    status: "available",
  };
}

function unavailable(
  reason: UnifiedFeatureUnavailableReason,
  detail?: string,
): UnifiedFeatureAvailability {
  return {
    status: "unavailable",
    reason,
    ...(detail ? { detail } : {}),
  };
}

function mapThreadSummary(
  provider: UnifiedProviderId,
  thread: {
    id: string;
    preview: string;
    title?: string | null | undefined;
    isGenerating?: boolean | undefined;
    createdAt: number;
    updatedAt: number;
    cwd?: string | undefined;
    source?: string | undefined;
  },
): UnifiedThreadSummary {
  return {
    id: thread.id,
    provider,
    preview: thread.preview,
    ...(thread.title !== undefined ? { title: thread.title } : {}),
    ...(thread.isGenerating !== undefined
      ? { isGenerating: thread.isGenerating }
      : {}),
    createdAt: normalizeUnixTimestampSeconds(thread.createdAt),
    updatedAt: normalizeUnixTimestampSeconds(thread.updatedAt),
    ...(thread.cwd ? { cwd: thread.cwd } : {}),
    ...(thread.source ? { source: thread.source } : {}),
  };
}

function mapThread(
  provider: UnifiedProviderId,
  thread: ThreadConversationState,
): UnifiedThread {
  return {
    id: thread.id,
    provider,
    turns: thread.turns.map((turn, turnIndex) => ({
      id: turn.id ?? turn.turnId ?? `${thread.id}-${String(turnIndex + 1)}`,
      ...(turn.turnId ? { turnId: turn.turnId } : {}),
      status: turn.status,
      ...(turn.turnStartedAtMs !== undefined
        ? { turnStartedAtMs: turn.turnStartedAtMs }
        : {}),
      ...(turn.finalAssistantStartedAtMs !== undefined
        ? { finalAssistantStartedAtMs: turn.finalAssistantStartedAtMs }
        : {}),
      ...(turn.error !== undefined
        ? { error: jsonValueFromString(JSON.stringify(turn.error)) }
        : {}),
      ...(turn.diff !== undefined
        ? { diff: jsonValueFromString(JSON.stringify(turn.diff)) }
        : {}),
      items: turn.items.map(mapTurnItem),
    })),
    requests: thread.requests
      .map((request) => maybeParseUserInputRequest(request))
      .filter((request) => request !== null)
      .map((request) => ({
        id: request.id,
        method: request.method,
        params: {
          threadId: request.params.threadId,
          turnId: request.params.turnId,
          itemId: request.params.itemId,
          questions: request.params.questions.map((question) => ({
            id: question.id,
            header: question.header,
            question: question.question,
            isOther: question.isOther ?? false,
            isSecret: question.isSecret ?? false,
            options: question.options.map((option) => ({
              label: option.label,
              description: option.description,
            })),
          })),
        },
        ...(typeof request.completed === "boolean"
          ? { completed: request.completed }
          : {}),
      })),
    ...(thread.createdAt !== undefined
      ? { createdAt: normalizeUnixTimestampSeconds(thread.createdAt) }
      : {}),
    ...(thread.updatedAt !== undefined
      ? { updatedAt: normalizeUnixTimestampSeconds(thread.updatedAt) }
      : {}),
    ...(thread.title !== undefined ? { title: thread.title } : {}),
    latestCollaborationMode: thread.latestCollaborationMode
      ? {
          mode: thread.latestCollaborationMode.mode,
          settings: {
            ...(thread.latestCollaborationMode.settings.model !== undefined
              ? { model: thread.latestCollaborationMode.settings.model }
              : {}),
            ...(thread.latestCollaborationMode.settings.reasoning_effort !==
            undefined
              ? {
                  reasoningEffort:
                    thread.latestCollaborationMode.settings.reasoning_effort,
                }
              : {}),
            ...(thread.latestCollaborationMode.settings
              .developer_instructions !== undefined
              ? {
                  developerInstructions:
                    thread.latestCollaborationMode.settings
                      .developer_instructions,
                }
              : {}),
          },
        }
      : null,
    latestModel: thread.latestModel ?? null,
    latestReasoningEffort: thread.latestReasoningEffort ?? null,
    ...(thread.cwd ? { cwd: thread.cwd } : {}),
    ...(thread.source ? { source: thread.source } : {}),
  };
}

function normalizeUnixTimestampSeconds(value: number): number {
  if (value >= 10_000_000_000) {
    return Math.floor(value / 1000);
  }
  return Math.floor(value);
}

function mapTurnItem(
  item: ThreadConversationState["turns"][number]["items"][number],
): UnifiedItem {
  switch (item.type) {
    case "userMessage":
      return {
        id: item.id,
        type: "userMessage",
        content: item.content.map((part) =>
          part.type === "text"
            ? { type: "text", text: part.text }
            : { type: "image", url: part.url },
        ),
      };

    case "steeringUserMessage":
      return {
        id: item.id,
        type: "steeringUserMessage",
        content: item.content.map((part) =>
          part.type === "text"
            ? { type: "text", text: part.text }
            : { type: "image", url: part.url },
        ),
        ...(item.attachments
          ? {
              attachments: item.attachments.map((attachment) =>
                jsonValueFromString(JSON.stringify(attachment)),
              ),
            }
          : {}),
      };

    case "agentMessage":
      return {
        id: item.id,
        type: "agentMessage",
        text: item.text,
      };

    case "error":
      return {
        id: item.id,
        type: "error",
        message: item.message,
        ...(typeof item.willRetry === "boolean"
          ? { willRetry: item.willRetry }
          : {}),
        ...(item.errorInfo !== undefined ? { errorInfo: item.errorInfo } : {}),
        ...(item.additionalDetails !== undefined
          ? {
              additionalDetails: jsonValueFromString(
                JSON.stringify(item.additionalDetails),
              ),
            }
          : {}),
      };

    case "reasoning":
      return {
        id: item.id,
        type: "reasoning",
        ...(item.summary ? { summary: item.summary } : {}),
        ...(item.text ? { text: item.text } : {}),
      };

    case "plan":
      return {
        id: item.id,
        type: "plan",
        text: item.text,
      };

    case "todo-list":
      return {
        id: item.id,
        type: "todoList",
        ...(item.explanation !== undefined
          ? { explanation: item.explanation }
          : {}),
        plan: item.plan.map((entry) => ({
          step: entry.step,
          status: entry.status,
        })),
      };

    case "planImplementation":
      return {
        id: item.id,
        type: "planImplementation",
        turnId: item.turnId,
        planContent: item.planContent,
        ...(typeof item.isCompleted === "boolean"
          ? { isCompleted: item.isCompleted }
          : {}),
      };

    case "userInputResponse":
      return {
        id: item.id,
        type: "userInputResponse",
        requestId: item.requestId,
        turnId: item.turnId,
        questions: item.questions.map((question) => ({
          id: question.id,
          ...(question.header !== undefined ? { header: question.header } : {}),
          ...(question.question !== undefined
            ? { question: question.question }
            : {}),
        })),
        answers: item.answers,
        ...(typeof item.completed === "boolean"
          ? { completed: item.completed }
          : {}),
      };

    case "commandExecution":
      return {
        id: item.id,
        type: "commandExecution",
        command: item.command,
        status: item.status,
        ...(item.cwd ? { cwd: item.cwd } : {}),
        ...(item.processId ? { processId: item.processId } : {}),
        ...(item.commandActions
          ? {
              commandActions: item.commandActions.map((action) => ({
                type: action.type,
                ...(action.command !== undefined
                  ? { command: action.command }
                  : {}),
                ...(action.name !== undefined ? { name: action.name } : {}),
                ...(action.path !== undefined ? { path: action.path } : {}),
                ...(action.query !== undefined ? { query: action.query } : {}),
              })),
            }
          : {}),
        ...(item.aggregatedOutput !== undefined
          ? { aggregatedOutput: item.aggregatedOutput }
          : {}),
        ...(item.exitCode !== undefined ? { exitCode: item.exitCode } : {}),
        ...(item.durationMs !== undefined
          ? { durationMs: item.durationMs }
          : {}),
      };

    case "fileChange":
      return {
        id: item.id,
        type: "fileChange",
        status: item.status,
        changes: item.changes.map((change) => ({
          path: change.path,
          kind: {
            type: change.kind.type,
            ...(change.kind.move_path !== undefined
              ? { movePath: change.kind.move_path }
              : {}),
          },
          ...(change.diff !== undefined ? { diff: change.diff } : {}),
        })),
      };

    case "contextCompaction":
      return {
        id: item.id,
        type: "contextCompaction",
        ...(typeof item.completed === "boolean"
          ? { completed: item.completed }
          : {}),
      };

    case "webSearch":
      return {
        id: item.id,
        type: "webSearch",
        query: item.query,
        action: {
          type: item.action.type,
          ...(item.action.query !== undefined
            ? { query: item.action.query }
            : {}),
          ...(item.action.queries !== undefined
            ? { queries: item.action.queries }
            : {}),
        },
      };

    case "mcpToolCall":
      return {
        id: item.id,
        type: "mcpToolCall",
        server: item.server,
        tool: item.tool,
        status: item.status,
        arguments: jsonValueFromString(JSON.stringify(item.arguments)),
        ...(item.result !== undefined
          ? {
              result: item.result
                ? {
                    content: item.result.content.map((entry) =>
                      jsonValueFromString(JSON.stringify(entry)),
                    ),
                    ...(item.result.structuredContent !== undefined
                      ? {
                          structuredContent:
                            item.result.structuredContent === null
                              ? null
                              : jsonValueFromString(
                                  JSON.stringify(item.result.structuredContent),
                                ),
                        }
                      : {}),
                  }
                : null,
            }
          : {}),
        ...(item.error !== undefined
          ? { error: item.error ? { message: item.error.message } : null }
          : {}),
        ...(item.durationMs !== undefined
          ? { durationMs: item.durationMs }
          : {}),
      };

    case "collabAgentToolCall":
      return {
        id: item.id,
        type: "collabAgentToolCall",
        tool: item.tool,
        status: item.status,
        senderThreadId: item.senderThreadId,
        receiverThreadIds: item.receiverThreadIds,
        ...(item.prompt !== undefined ? { prompt: item.prompt } : {}),
        agentsStates: item.agentsStates,
      };

    case "imageView":
      return {
        id: item.id,
        type: "imageView",
        path: item.path,
      };

    case "enteredReviewMode":
      return {
        id: item.id,
        type: "enteredReviewMode",
        review: item.review,
      };

    case "exitedReviewMode":
      return {
        id: item.id,
        type: "exitedReviewMode",
        review: item.review,
      };

    case "modelChanged":
      return {
        id: item.id,
        type: "modelChanged",
        ...(item.fromModel !== undefined ? { fromModel: item.fromModel } : {}),
        ...(item.toModel !== undefined ? { toModel: item.toModel } : {}),
      };

    default:
      return assertNever(item);
  }
}

function jsonValueFromString(serialized: string): JsonValue {
  return JsonValueSchema.parse(JSON.parse(serialized));
}

type MissingCommandHandlers = Exclude<
  UnifiedCommandKind,
  keyof UnifiedCommandHandlerTable
>;
type ExtraCommandHandlers = Exclude<
  keyof UnifiedCommandHandlerTable,
  UnifiedCommandKind
>;

type AssertTrue<T extends true> = T;
type IsNever<T> = [T] extends [never] ? true : false;

type _AssertNoMissingCommandHandlers = AssertTrue<
  IsNever<MissingCommandHandlers>
>;
type _AssertNoExtraCommandHandlers = AssertTrue<IsNever<ExtraCommandHandlers>>;

void {
  commandKinds: UNIFIED_COMMAND_KINDS,
  featureIds: UNIFIED_FEATURE_IDS,
  providerSupport: PROVIDER_FEATURE_SUPPORT,
  featureByCommandKind: FEATURE_ID_BY_COMMAND_KIND,
};

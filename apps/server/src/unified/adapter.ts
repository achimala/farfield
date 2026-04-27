import {
  assertNever,
  type ThreadConversationState,
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
import { z } from "zod";
import type { AgentAdapter } from "../agents/types.js";

type UnifiedCommandByKind<K extends UnifiedCommandKind> = Extract<
  UnifiedCommand,
  { kind: K }
>;
type UnifiedCommandResultByKind<K extends UnifiedCommandKind> = Extract<
  UnifiedCommandResult,
  { kind: K }
>;

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
  requestConnectionCheck(): void;
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

  public requestConnectionCheck(): void {
    this.adapter.requestConnectionCheck?.();
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
        ...(command.model ? { model: command.model } : {}),
        ...(command.effort ? { effort: command.effort } : {}),
        ...(command.collaborationMode
          ? {
              collaborationMode: {
                mode: command.collaborationMode.mode,
                settings: {
                  model: command.collaborationMode.settings.model,
                  ...(command.collaborationMode.settings.reasoningEffort !==
                  undefined
                    ? {
                        reasoning_effort:
                          command.collaborationMode.settings.reasoningEffort
                      }
                    : {}),
                  ...(command.collaborationMode.settings
                    .developerInstructions !== undefined
                    ? {
                        developer_instructions:
                          command.collaborationMode.settings
                            .developerInstructions
                      }
                    : {})
                }
              }
            }
          : {}),
        ...(typeof command.isSteering === "boolean"
          ? { isSteering: command.isSteering }
          : {}),
        ...(command.approvalPolicy
          ? { approvalPolicy: command.approvalPolicy }
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
            model: command.collaborationMode.settings.model,
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
    waitingOnApproval?: boolean | undefined;
    waitingOnUserInput?: boolean | undefined;
    status?: unknown;
    createdAt: number;
    updatedAt: number;
    cwd?: string | undefined;
    source?: string | undefined;
  },
): UnifiedThreadSummary {
  const waitingState = parseThreadWaitingState(thread.status);
  const waitingOnApproval =
    thread.waitingOnApproval ?? waitingState?.waitingOnApproval;
  const waitingOnUserInput =
    thread.waitingOnUserInput ?? waitingState?.waitingOnUserInput;
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
    ...(waitingOnApproval !== undefined ? { waitingOnApproval } : {}),
    ...(waitingOnUserInput !== undefined ? { waitingOnUserInput } : {}),
    ...(thread.cwd ? { cwd: thread.cwd } : {}),
    ...(thread.source ? { source: thread.source } : {}),
  };
}

const ThreadSummaryActiveFlagSchema = z.enum([
  "waitingOnApproval",
  "waitingOnUserInput",
]);

const ThreadSummaryStatusSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("active"),
      activeFlags: z.array(ThreadSummaryActiveFlagSchema),
    })
    .passthrough(),
  z.object({ type: z.literal("idle") }).passthrough(),
  z.object({ type: z.literal("notLoaded") }).passthrough(),
  z.object({ type: z.literal("systemError") }).passthrough(),
]);

function parseThreadWaitingState(
  status: unknown,
): {
  waitingOnApproval: boolean;
  waitingOnUserInput: boolean;
} | null {
  const parsed = ThreadSummaryStatusSchema.safeParse(status);
  if (!parsed.success) {
    return null;
  }

  if (parsed.data.type !== "active") {
    return {
      waitingOnApproval: false,
      waitingOnUserInput: false,
    };
  }

  return {
    waitingOnApproval: parsed.data.activeFlags.includes("waitingOnApproval"),
    waitingOnUserInput: parsed.data.activeFlags.includes("waitingOnUserInput"),
  };
}

type ThreadTurn = ThreadConversationState["turns"][number];
type ThreadTurnItem = ThreadTurn["items"][number];

function normalizeThreadForUnifiedMapping(
  thread: ThreadConversationState,
): ThreadConversationState {
  return {
    ...thread,
    turns: mergeThreadTurnsForUnifiedMapping(
      thread.turns.map((turn) => ({
        ...turn,
        items: mergeTurnItemsForUnifiedMapping(turn.items, []),
      })),
      [],
    ),
  };
}

function mergeThreadTurnsForUnifiedMapping(
  currentTurns: ThreadTurn[],
  nextTurns: ThreadTurn[],
): ThreadTurn[] {
  const nextTurnsByKey = new Map<string, ThreadTurn>();
  for (const nextTurn of nextTurns) {
    for (const key of threadTurnKeysForUnifiedMapping(nextTurn)) {
      nextTurnsByKey.set(key, nextTurn);
    }
  }

  const mergedTurns: ThreadTurn[] = [];
  const seenKeys = new Set<string>();
  const mergedTurnIndexesByKey = new Map<string, number>();
  for (const currentTurn of currentTurns) {
    const currentKeys = threadTurnKeysForUnifiedMapping(currentTurn);
    if (currentKeys.some((key) => seenKeys.has(key))) {
      const duplicateIndex = findMergedIndexForKeys(
        mergedTurnIndexesByKey,
        currentKeys,
      );
      if (duplicateIndex !== null) {
        const existingTurn = mergedTurns[duplicateIndex];
        if (existingTurn === undefined) {
          throw new Error("Merged turn index is missing");
        }
        const mergedTurn = mergeThreadTurnForUnifiedMapping(
          existingTurn,
          currentTurn,
        );
        mergedTurns[duplicateIndex] = mergedTurn;
        for (const key of threadTurnKeysForUnifiedMapping(mergedTurn)) {
          seenKeys.add(key);
          mergedTurnIndexesByKey.set(key, duplicateIndex);
        }
      }
      continue;
    }

    const nextTurn =
      currentKeys
        .map((key) => nextTurnsByKey.get(key))
        .find((turn) => turn !== undefined) ?? null;
    if (!nextTurn) {
      mergedTurns.push(currentTurn);
      const currentIndex = mergedTurns.length - 1;
      for (const key of currentKeys) {
        seenKeys.add(key);
        mergedTurnIndexesByKey.set(key, currentIndex);
      }
      continue;
    }

    const mergedTurn = mergeThreadTurnForUnifiedMapping(currentTurn, nextTurn);
    mergedTurns.push(mergedTurn);
    const mergedIndex = mergedTurns.length - 1;
    for (const key of [
      ...currentKeys,
      ...threadTurnKeysForUnifiedMapping(nextTurn),
    ]) {
      seenKeys.add(key);
      mergedTurnIndexesByKey.set(key, mergedIndex);
    }
  }

  for (const nextTurn of nextTurns) {
    const nextKeys = threadTurnKeysForUnifiedMapping(nextTurn);
    if (nextKeys.some((key) => seenKeys.has(key))) {
      const duplicateIndex = findMergedIndexForKeys(
        mergedTurnIndexesByKey,
        nextKeys,
      );
      if (duplicateIndex !== null) {
        const existingTurn = mergedTurns[duplicateIndex];
        if (existingTurn === undefined) {
          throw new Error("Merged turn index is missing");
        }
        const mergedTurn = mergeThreadTurnForUnifiedMapping(
          existingTurn,
          nextTurn,
        );
        mergedTurns[duplicateIndex] = mergedTurn;
        for (const key of threadTurnKeysForUnifiedMapping(mergedTurn)) {
          seenKeys.add(key);
          mergedTurnIndexesByKey.set(key, duplicateIndex);
        }
      }
      continue;
    }
    mergedTurns.push(nextTurn);
    const nextIndex = mergedTurns.length - 1;
    for (const key of nextKeys) {
      seenKeys.add(key);
      mergedTurnIndexesByKey.set(key, nextIndex);
    }
  }

  return mergedTurns;
}

function mergeThreadTurnForUnifiedMapping(
  currentTurn: ThreadTurn,
  nextTurn: ThreadTurn,
): ThreadTurn {
  const preferNextTurn =
    nextTurn.turnId !== undefined || currentTurn.turnId === undefined;
  return {
    ...(preferNextTurn ? currentTurn : nextTurn),
    ...(preferNextTurn ? nextTurn : currentTurn),
    turnId: nextTurn.turnId ?? currentTurn.turnId,
    items: preferNextTurn
      ? mergeTurnItemsForUnifiedMapping(
          nextTurn.items,
          currentTurn.items,
          "current",
        )
      : mergeTurnItemsForUnifiedMapping(
          currentTurn.items,
          nextTurn.items,
          "current",
        ),
  };
}

function findMergedIndexForKeys(
  indexByKey: Map<string, number>,
  keys: string[],
): number | null {
  return keys.map((key) => indexByKey.get(key)).find((index) => index !== undefined) ?? null;
}

function threadTurnKeysForUnifiedMapping(turn: ThreadTurn): string[] {
  const keys: string[] = [];
  if (turn.turnId && turn.turnId.trim().length > 0) {
    const value = turn.turnId.trim();
    keys.push(`turnId:${value}`);
    keys.push(`turn:${value}`);
  }
  if (turn.id && turn.id.trim().length > 0) {
    const value = turn.id.trim();
    keys.push(`id:${value}`);
    keys.push(`turn:${value}`);
  }
  return keys;
}

function mergeTurnItemsForUnifiedMapping(
  currentItems: ThreadTurnItem[],
  nextItems: ThreadTurnItem[],
  preferredItem: "current" | "next" = "next",
): ThreadTurnItem[] {
  const nextItemsByKey = new Map<string, ThreadTurnItem>();
  for (const nextItem of nextItems) {
    for (const key of turnItemKeysForUnifiedMapping(nextItem)) {
      nextItemsByKey.set(key, nextItem);
    }
  }

  const mergedItems: ThreadTurnItem[] = [];
  const seenKeys = new Set<string>();
  for (const currentItem of currentItems) {
    const currentKeys = turnItemKeysForUnifiedMapping(currentItem);
    if (currentKeys.some((key) => seenKeys.has(key))) {
      continue;
    }

    const nextItem =
      currentKeys
        .map((key) => nextItemsByKey.get(key))
        .find((item) => item !== undefined) ?? null;
    if (!nextItem) {
      mergedItems.push(currentItem);
      for (const key of currentKeys) {
        seenKeys.add(key);
      }
      continue;
    }

    mergedItems.push(preferredItem === "current" ? currentItem : nextItem);
    for (const key of [
      ...currentKeys,
      ...turnItemKeysForUnifiedMapping(nextItem),
    ]) {
      seenKeys.add(key);
    }
  }

  for (const nextItem of nextItems) {
    const nextKeys = turnItemKeysForUnifiedMapping(nextItem);
    if (nextKeys.some((key) => seenKeys.has(key))) {
      continue;
    }
    mergedItems.push(nextItem);
    for (const key of nextKeys) {
      seenKeys.add(key);
    }
  }

  return mergedItems;
}

function turnItemKeysForUnifiedMapping(item: ThreadTurnItem): string[] {
  const keys = [`id:${item.type}:${turnItemIdForUnifiedMapping(item)}`];
  const contentKey = turnItemContentKeyForUnifiedMapping(item);
  if (contentKey) {
    keys.push(contentKey);
  }
  return keys;
}

function turnItemIdForUnifiedMapping(item: ThreadTurnItem): string {
  switch (item.type) {
    case "message":
      return `message:${item.role}:${JSON.stringify(item.content)}`;
    case "local_shell_call":
      return item.call_id ?? `local_shell_call:${JSON.stringify(item.action)}`;
    case "custom_tool_call":
    case "custom_tool_call_output":
    case "function_call":
    case "function_call_output":
    case "tool_search_call":
    case "tool_search_output":
      return item.id ?? item.call_id;
    case "web_search_call":
      return item.id ?? `web_search_call:${JSON.stringify(item.action)}`;
    case "ghost_snapshot":
      return `ghost_snapshot:${JSON.stringify(item.ghost_commit)}`;
    case "compaction":
      return `compaction:${item.encrypted_content}`;
    case "other":
      return "other";
    case "automaticApprovalReview":
      return item.id;
    case "mcpServerElicitation":
      return item.id;
    default:
      return item.id;
  }
}

function turnItemContentKeyForUnifiedMapping(
  item: ThreadTurnItem,
): string | null {
  switch (item.type) {
    case "agentMessage":
      return `agentMessage:${item.text}`;
    case "userMessage":
    case "steeringUserMessage":
      return `${item.type}:${userMessageContentKeyForUnifiedMapping(item.content)}`;
    default:
      return null;
  }
}

function userMessageContentKeyForUnifiedMapping(
  content: ThreadUserMessageItem["content"],
): string {
  return content
    .map((part) => {
      switch (part.type) {
        case "text":
          return `text:${part.text}`;
        case "image":
          return `image:${part.url}`;
        case "localImage":
          return `localImage:${part.path}`;
        case "skill":
        case "mention":
          return `${part.type}:${part.name}:${part.path}`;
        default:
          return assertNever(part);
      }
    })
    .join("\n");
}

export function mapThread(
  provider: UnifiedProviderId,
  thread: ThreadConversationState,
): UnifiedThread {
  const normalizedThread = normalizeThreadForUnifiedMapping(thread);
  return {
    id: normalizedThread.id,
    provider,
    turns: normalizedThread.turns.map((turn, turnIndex) => ({
      id:
        turn.id ??
        turn.turnId ??
        `${normalizedThread.id}-${String(turnIndex + 1)}`,
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
    requests: normalizedThread.requests.map((request) =>
      mapThreadRequest(request),
    ),
    ...(normalizedThread.createdAt !== undefined
      ? { createdAt: normalizeUnixTimestampSeconds(normalizedThread.createdAt) }
      : {}),
    ...(normalizedThread.updatedAt !== undefined
      ? { updatedAt: normalizeUnixTimestampSeconds(normalizedThread.updatedAt) }
      : {}),
    ...(normalizedThread.title !== undefined
      ? { title: normalizedThread.title }
      : {}),
    latestCollaborationMode: normalizedThread.latestCollaborationMode
      ? {
          mode: normalizedThread.latestCollaborationMode.mode,
          settings: {
            ...(normalizedThread.latestCollaborationMode.settings.model !==
            undefined
              ? { model: normalizedThread.latestCollaborationMode.settings.model }
              : {}),
            ...(normalizedThread.latestCollaborationMode.settings
              .reasoning_effort !==
            undefined
              ? {
                  reasoningEffort:
                    normalizedThread.latestCollaborationMode.settings
                      .reasoning_effort,
                }
              : {}),
            ...(normalizedThread.latestCollaborationMode.settings
              .developer_instructions !== undefined
              ? {
                  developerInstructions:
                    normalizedThread.latestCollaborationMode.settings
                      .developer_instructions,
                }
              : {}),
          },
        }
      : null,
    latestModel: normalizedThread.latestModel ?? null,
    latestReasoningEffort: normalizedThread.latestReasoningEffort ?? null,
    ...(normalizedThread.latestTokenUsageInfo !== undefined
      ? {
          latestTokenUsageInfo: jsonValueFromString(
            JSON.stringify(normalizedThread.latestTokenUsageInfo),
          ),
        }
      : {}),
    ...(normalizedThread.cwd ? { cwd: normalizedThread.cwd } : {}),
    ...(normalizedThread.source ? { source: normalizedThread.source } : {}),
  };
}

export function mapThreadRequest(
  request: ThreadConversationState["requests"][number],
): UnifiedThread["requests"][number] {
  switch (request.method) {
    case "item/tool/requestUserInput": {
      const parsed = UserInputRequestSchema.parse(request);
      return {
        id: parsed.id,
        method: parsed.method,
        params: {
          threadId: parsed.params.threadId,
          turnId: parsed.params.turnId,
          itemId: parsed.params.itemId,
          questions: parsed.params.questions.map((question) => ({
            id: question.id,
            header: question.header,
            question: question.question,
            isOther: question.isOther ?? false,
            isSecret: question.isSecret ?? false,
            options: (question.options ?? []).map((option) => ({
              label: option.label,
              description: option.description,
            })),
          })),
        },
        ...(typeof parsed.completed === "boolean"
          ? { completed: parsed.completed }
          : {}),
      };
    }

    case "item/plan/requestImplementation":
      return {
        id: request.id,
        method: request.method,
        params: {
          threadId: request.params.threadId,
          turnId: request.params.turnId,
          planContent: request.params.planContent,
        },
        ...(typeof request.completed === "boolean"
          ? { completed: request.completed }
          : {}),
      };

    case "account/chatgptAuthTokens/refresh":
      return {
        id: request.id,
        method: request.method,
        params: {
          reason: request.params.reason,
          ...(request.params.previousAccountId !== undefined
            ? { previousAccountId: request.params.previousAccountId }
            : {}),
        },
        ...(typeof request.completed === "boolean"
          ? { completed: request.completed }
          : {}),
      };

    case "applyPatchApproval":
      return {
        id: request.id,
        method: request.method,
        params: {
          conversationId: request.params.conversationId,
          callId: request.params.callId,
          fileChanges: jsonRecordFromString(
            JSON.stringify(request.params.fileChanges),
          ),
          reason: request.params.reason,
          grantRoot: request.params.grantRoot,
        },
        ...(typeof request.completed === "boolean"
          ? { completed: request.completed }
          : {}),
      };

    case "execCommandApproval":
      return {
        id: request.id,
        method: request.method,
        params: {
          conversationId: request.params.conversationId,
          callId: request.params.callId,
          approvalId: request.params.approvalId,
          command: request.params.command,
          cwd: request.params.cwd,
          reason: request.params.reason,
          parsedCmd: jsonArrayFromString(JSON.stringify(request.params.parsedCmd)),
        },
        ...(typeof request.completed === "boolean"
          ? { completed: request.completed }
          : {}),
      };

    case "item/commandExecution/requestApproval":
      return {
        id: request.id,
        method: request.method,
        params: {
          threadId: request.params.threadId,
          turnId: request.params.turnId,
          itemId: request.params.itemId,
          ...(request.params.approvalId !== undefined
            ? { approvalId: request.params.approvalId }
            : {}),
          ...(request.params.reason !== undefined
            ? { reason: request.params.reason }
            : {}),
          ...(request.params.networkApprovalContext !== undefined
            ? {
                networkApprovalContext: request.params.networkApprovalContext,
              }
            : {}),
          ...(request.params.command !== undefined
            ? { command: request.params.command }
            : {}),
          ...(request.params.cwd !== undefined ? { cwd: request.params.cwd } : {}),
          ...(request.params.commandActions !== undefined
            ? { commandActions: request.params.commandActions }
            : {}),
          ...(request.params.additionalPermissions !== undefined
            ? {
                additionalPermissions: request.params.additionalPermissions,
              }
            : {}),
          ...(request.params.proposedExecpolicyAmendment !== undefined
            ? {
                proposedExecpolicyAmendment:
                  request.params.proposedExecpolicyAmendment,
              }
            : {}),
          ...(request.params.proposedNetworkPolicyAmendments !== undefined
            ? {
                proposedNetworkPolicyAmendments:
                  request.params.proposedNetworkPolicyAmendments,
              }
            : {}),
          ...(request.params.availableDecisions !== undefined
            ? { availableDecisions: request.params.availableDecisions }
            : {}),
        },
        ...(typeof request.completed === "boolean"
          ? { completed: request.completed }
          : {}),
      };

    case "item/fileChange/requestApproval":
      return {
        id: request.id,
        method: request.method,
        params: {
          threadId: request.params.threadId,
          turnId: request.params.turnId,
          itemId: request.params.itemId,
          ...(request.params.reason !== undefined
            ? { reason: request.params.reason }
            : {}),
          ...(request.params.grantRoot !== undefined
            ? { grantRoot: request.params.grantRoot }
            : {}),
        },
        ...(typeof request.completed === "boolean"
          ? { completed: request.completed }
          : {}),
      };

    case "item/tool/call":
      return {
        id: request.id,
        method: request.method,
        params: {
          threadId: request.params.threadId,
          turnId: request.params.turnId,
          callId: request.params.callId,
          tool: request.params.tool,
          arguments: jsonValueFromString(JSON.stringify(request.params.arguments)),
        },
        ...(typeof request.completed === "boolean"
          ? { completed: request.completed }
          : {}),
      };

    default:
      throw new Error(
        `Unsupported thread request method: ${String(request.method)}`,
      );
  }
}

function normalizeUnixTimestampSeconds(value: number): number {
  if (value >= 10_000_000_000) {
    return Math.floor(value / 1000);
  }
  return Math.floor(value);
}

type ThreadUserMessageItem = Extract<
  ThreadConversationState["turns"][number]["items"][number],
  { type: "userMessage" | "steeringUserMessage" }
>;

type ThreadUserMessagePart = ThreadUserMessageItem["content"][number];
type RawResponseMessageItem = Extract<
  ThreadConversationState["turns"][number]["items"][number],
  { type: "message" }
>;
type RawResponseMessageContentPart = RawResponseMessageItem["content"][number];
type RawToolOutput =
  | Extract<
      ThreadConversationState["turns"][number]["items"][number],
      { type: "custom_tool_call_output" }
    >["output"]
  | Extract<
      ThreadConversationState["turns"][number]["items"][number],
      { type: "function_call_output" }
    >["output"];

type UnifiedUserMessagePart = Extract<
  UnifiedItem,
  { type: "userMessage" | "steeringUserMessage" }
>["content"][number];

function mapInputPart(
  part: ThreadUserMessagePart,
): UnifiedUserMessagePart {
  switch (part.type) {
    case "text":
      return {
        type: "text",
        text: part.text,
      };
    case "image":
      return {
        type: "image",
        url: part.url,
      };
    case "localImage":
      return {
        type: "localImage",
        path: part.path,
      };
    case "skill":
      return {
        type: "skill",
        name: part.name,
        path: part.path,
      };
    case "mention":
      return {
        type: "mention",
        name: part.name,
        path: part.path,
      };
    default:
      return assertNever(part);
  }
}

function mapRawResponseMessagePart(
  part: RawResponseMessageContentPart,
): UnifiedUserMessagePart {
  switch (part.type) {
    case "input_text":
    case "output_text":
      return {
        type: "text",
        text: part.text,
      };
    case "input_image":
      return {
        type: "image",
        url: part.image_url,
      };
    default:
      return assertNever(part);
  }
}

function rawResponseMessageText(item: RawResponseMessageItem): string {
  return item.content
    .map((part) => {
      switch (part.type) {
        case "input_text":
        case "output_text":
          return part.text;
        case "input_image":
          return part.image_url;
        default:
          return assertNever(part);
      }
    })
    .join("\n");
}

function rawResponseMessageId(item: RawResponseMessageItem): string {
  return `message:${item.role}:${JSON.stringify(item.content)}`;
}

function rawJsonValueToText(value: RawToolOutput): string {
  const stringValue = z.string().safeParse(value);
  if (stringValue.success) {
    return stringValue.data;
  }
  return JSON.stringify(value);
}

function mapTurnItem(
  item: ThreadConversationState["turns"][number]["items"][number],
): UnifiedItem {
  switch (item.type) {
    case "message":
      if (item.role === "assistant") {
        return {
          id: rawResponseMessageId(item),
          type: "agentMessage",
          text: rawResponseMessageText(item),
        };
      }
      return {
        id: rawResponseMessageId(item),
        type: "userMessage",
        content: item.content.map(mapRawResponseMessagePart),
      };

    case "userMessage":
      return {
        id: item.id,
        type: "userMessage",
        content: item.content.map(mapInputPart),
      };

    case "steeringUserMessage":
      return {
        id: item.id,
        type: "steeringUserMessage",
        content: item.content.map(mapInputPart),
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
                ...(action.query !== undefined && action.query !== null
                  ? { query: action.query }
                  : {}),
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

    case "local_shell_call":
      return {
        id: item.call_id ?? `local_shell_call:${JSON.stringify(item.action)}`,
        type: "commandExecution",
        command: item.action.command.join(" "),
        status: item.status === "in_progress" ? "inProgress" : item.status,
        ...(item.action.working_directory
          ? { cwd: item.action.working_directory }
          : {}),
        commandActions: [
          {
            type: item.action.type,
            command: item.action.command.join(" "),
          },
        ],
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
        ...(item.action !== undefined
          ? {
              action:
                item.action === null
                  ? null
                  : item.action.type === "search"
                    ? {
                        type: "search" as const,
                        ...(item.action.query !== undefined
                          ? { query: item.action.query }
                          : {}),
                        ...(item.action.queries !== undefined
                          ? { queries: item.action.queries }
                          : {}),
                      }
                    : item.action.type === "openPage"
                      ? {
                          type: "openPage" as const,
                          ...(item.action.url !== undefined
                            ? { url: item.action.url }
                            : {}),
                        }
                      : item.action.type === "findInPage"
                        ? {
                            type: "findInPage" as const,
                            ...(item.action.url !== undefined
                              ? { url: item.action.url }
                              : {}),
                            ...(item.action.pattern !== undefined
                              ? { pattern: item.action.pattern }
                              : {}),
                          }
                        : {
                            type: "other" as const,
                          },
            }
          : {}),
      };

    case "web_search_call":
      return {
        id: item.id ?? `web_search_call:${JSON.stringify(item.action)}`,
        type: "webSearch",
        query:
          item.action.type === "search" && item.action.query
            ? item.action.query
            : "",
        action:
          item.action.type === "search"
            ? {
                type: "search" as const,
                ...(item.action.query !== undefined
                  ? { query: item.action.query }
                  : {}),
                ...(item.action.queries !== undefined
                  ? { queries: item.action.queries }
                  : {}),
              }
            : item.action.type === "openPage"
              ? {
                  type: "openPage" as const,
                  ...(item.action.url !== undefined
                    ? { url: item.action.url }
                    : {}),
                }
              : item.action.type === "findInPage"
                ? {
                    type: "findInPage" as const,
                    ...(item.action.url !== undefined
                      ? { url: item.action.url }
                      : {}),
                    ...(item.action.pattern !== undefined
                      ? { pattern: item.action.pattern }
                      : {}),
                  }
                : {
                    type: "other" as const,
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

    case "dynamicToolCall":
      return {
        id: item.id,
        type: "dynamicToolCall",
        tool: item.tool,
        arguments: jsonValueFromString(JSON.stringify(item.arguments)),
        status: item.status,
        ...(item.contentItems !== undefined
          ? {
              contentItems:
                item.contentItems === null
                  ? null
                  : item.contentItems.map((contentItem) =>
                      contentItem.type === "inputText"
                        ? {
                            type: "inputText" as const,
                            text: contentItem.text,
                          }
                        : {
                            type: "inputImage" as const,
                            imageUrl: contentItem.imageUrl,
                          },
                    ),
            }
          : {}),
        ...(item.success !== undefined ? { success: item.success } : {}),
        ...(item.durationMs !== undefined
          ? { durationMs: item.durationMs }
          : {}),
      };

    case "custom_tool_call":
      return {
        id: item.id ?? item.call_id,
        type: "dynamicToolCall",
        tool: item.name,
        arguments: jsonValueFromString(
          JSON.stringify({
            input: item.input,
          }),
        ),
        status: item.status === "in_progress" ? "inProgress" : item.status,
      };

    case "custom_tool_call_output":
      return {
        id: item.id ?? item.call_id,
        type: "dynamicToolCall",
        tool: "custom_tool_call_output",
        arguments: jsonValueFromString(
          JSON.stringify({
            callId: item.call_id,
          }),
        ),
        status: "completed",
        contentItems: [
          {
            type: "inputText",
            text: rawJsonValueToText(item.output),
          },
        ],
      };

    case "function_call":
      return {
        id: item.id ?? item.call_id,
        type: "dynamicToolCall",
        tool: item.name,
        arguments: jsonValueFromString(item.arguments),
        status: "completed",
      };

    case "function_call_output":
      return {
        id: item.id ?? item.call_id,
        type: "dynamicToolCall",
        tool: "function_call_output",
        arguments: jsonValueFromString(
          JSON.stringify({
            callId: item.call_id,
          }),
        ),
        status: "completed",
        contentItems: [
          {
            type: "inputText",
            text: rawJsonValueToText(item.output),
          },
        ],
      };

    case "tool_search_call":
      return {
        id: item.id ?? item.call_id,
        type: "dynamicToolCall",
        tool: "tool_search",
        arguments: jsonValueFromString(JSON.stringify(item.arguments)),
        status: item.status === "in_progress" ? "inProgress" : item.status,
      };

    case "tool_search_output":
      return {
        id: item.id ?? item.call_id,
        type: "dynamicToolCall",
        tool: "tool_search_output",
        arguments: jsonValueFromString(
          JSON.stringify({
            callId: item.call_id,
            execution: item.execution,
          }),
        ),
        status: item.status === "in_progress" ? "inProgress" : item.status,
        contentItems: [
          {
            type: "inputText",
            text: JSON.stringify(item.tools),
          },
        ],
      };

    case "ghost_snapshot":
      return {
        id: `ghost_snapshot:${JSON.stringify(item.ghost_commit)}`,
        type: "dynamicToolCall",
        tool: "ghost_snapshot",
        arguments: jsonValueFromString(JSON.stringify(item.ghost_commit)),
        status: "completed",
      };

    case "compaction":
      return {
        id: `compaction:${item.encrypted_content}`,
        type: "contextCompaction",
        completed: true,
      };

    case "other":
      return {
        id: "other",
        type: "dynamicToolCall",
        tool: "other",
        arguments: null,
        status: "completed",
      };

    case "automaticApprovalReview":
      return {
        id: item.id,
        type: "dynamicToolCall",
        tool: "automaticApprovalReview",
        arguments: jsonValueFromString(
          JSON.stringify({
            status: item.status,
            riskLevel: item.riskLevel,
            userAuthorization: item.userAuthorization,
            rationale: item.rationale,
          }),
        ),
        status: "completed",
      };

    case "mcpServerElicitation":
      return {
        id: item.id,
        type: "dynamicToolCall",
        tool: "mcpServerElicitation",
        arguments: jsonValueFromString(
          JSON.stringify({
            requestId: item.requestId,
            turnId: item.turnId,
            elicitation: item.elicitation,
            ...(item.completed !== undefined
              ? { completed: item.completed }
              : {}),
            ...(item.action !== undefined ? { action: item.action } : {}),
          }),
        ),
        status: item.completed ? "completed" : "inProgress",
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

    case "remoteTaskCreated":
      return {
        id: item.id,
        type: "remoteTaskCreated",
        taskId: item.taskId,
      };

    case "modelChanged":
      return {
        id: item.id,
        type: "modelChanged",
        ...(item.fromModel !== undefined ? { fromModel: item.fromModel } : {}),
        ...(item.toModel !== undefined ? { toModel: item.toModel } : {}),
      };

    case "forkedFromConversation":
      return {
        id: item.id,
        type: "forkedFromConversation",
        sourceConversationId: item.sourceConversationId,
        ...(item.sourceConversationTitle !== undefined
          ? { sourceConversationTitle: item.sourceConversationTitle }
          : {}),
      };

    default:
      return assertNever(item);
  }
}

function jsonValueFromString(serialized: string): JsonValue {
  return JsonValueSchema.parse(JSON.parse(serialized));
}

function jsonArrayFromString(serialized: string): JsonValue[] {
  return z.array(JsonValueSchema).parse(JSON.parse(serialized));
}

function jsonRecordFromString(serialized: string): Record<string, JsonValue> {
  return z.record(JsonValueSchema).parse(JSON.parse(serialized));
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

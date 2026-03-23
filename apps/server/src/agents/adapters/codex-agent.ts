import { access, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  AppServerClient,
  AppServerRpcError,
  AppServerTransportError,
  CodexMonitorService,
  DesktopIpcError,
  DesktopIpcClient,
  reduceThreadStreamEvents,
  ThreadStreamReductionError,
  type SendRequestOptions,
} from "@farfield/api";
import {
  ProtocolValidationError,
  parseCommandExecutionRequestApprovalResponse,
  parseFileChangeRequestApprovalResponse,
  parseToolRequestUserInputResponsePayload,
  parseThreadConversationState,
  parseThreadStreamStateChangedBroadcast,
  parseUserInputResponsePayload,
  type IpcFrame,
  type IpcRequestFrame,
  type IpcResponseFrame,
  type ThreadConversationRequest,
  type ThreadConversationState,
  type ThreadStreamStateChangedBroadcast,
  type UserInputRequestId,
} from "@farfield/protocol";
import { logger } from "../../logger.js";
import { resolveOwnerClientId } from "../../thread-owner.js";
import type {
  AgentAdapter,
  AgentCapabilities,
  AgentCreateThreadInput,
  AgentCreateThreadResult,
  AgentInterruptInput,
  AgentListThreadsInput,
  AgentListThreadsResult,
  AgentReadThreadInput,
  AgentReadThreadResult,
  AgentSendMessageInput,
  AgentSetCollaborationModeInput,
  AgentSubmitUserInputInput,
  AgentThreadLiveState,
  AgentThreadStreamEvents,
} from "../types.js";

type StreamSnapshotOrigin = "stream" | "readThreadWithTurns" | "readThread";

export interface CodexAgentRuntimeState {
  appReady: boolean;
  ipcConnected: boolean;
  ipcInitialized: boolean;
  codexAvailable: boolean;
  lastError: string | null;
}

export interface CodexIpcFrameEvent {
  direction: "in" | "out";
  frame: IpcFrame;
  method: string;
  threadId: string | null;
}

export interface CodexAgentOptions {
  appExecutable: string;
  socketPath: string;
  workspaceDir: string;
  userAgent: string;
  reconnectDelayMs: number;
  onStateChange?: () => void;
}

const ANSI_ESCAPE_REGEX = /\u001B\[[0-?]*[ -/]*[@-~]/g;
const MAX_TRACKED_THREAD_RUNTIME_STATES = 80;
const MAX_STREAM_EVENTS_PER_THREAD = 120;
const ARCHIVED_TOOL_ARGUMENT_PREVIEW_MAX_CHARS = 600;
const ARCHIVED_TOOL_TEXT_PREVIEW_MAX_CHARS = 240;
const loggedArchivedUnknownPayloadTypes = new Set<string>();
const loggedArchivedMalformedJsonlLineKeys = new Set<string>();

type ArchivedJsonValue =
  | string
  | number
  | boolean
  | null
  | ArchivedJsonValue[]
  | { [key: string]: ArchivedJsonValue };

type ArchivedThreadItem = ThreadConversationState["turns"][number]["items"][number];
type ArchivedDynamicToolCallItem = Extract<
  ArchivedThreadItem,
  { type: "dynamicToolCall" }
>;
type ArchivedDynamicToolContentItem = NonNullable<
  ArchivedDynamicToolCallItem["contentItems"]
>[number];
type ArchivedTodoListItem = Extract<ArchivedThreadItem, { type: "todoList" }>;

export class CodexAgentAdapter implements AgentAdapter {
  public readonly id = "codex";
  public readonly label = "Codex";
  public readonly capabilities: AgentCapabilities = {
    canListModels: true,
    canListCollaborationModes: true,
    canSetCollaborationMode: true,
    canSubmitUserInput: true,
    canReadLiveState: true,
    canReadStreamEvents: true,
    canReadRateLimits: true,
  };

  protected readonly appClient: AppServerClient;
  private readonly ipcClient: DesktopIpcClient;
  private readonly service: CodexMonitorService;
  private readonly onStateChange: (() => void) | null;
  private readonly reconnectDelayMs: number;

  private readonly threadOwnerById = new Map<string, string>();
  private readonly streamEventsByThreadId = new Map<string, IpcFrame[]>();
  private readonly streamSnapshotByThreadId = new Map<
    string,
    ThreadConversationState
  >();
  private readonly streamSnapshotOriginByThreadId = new Map<
    string,
    StreamSnapshotOrigin
  >();
  private readonly threadTitleById = new Map<string, string | null>();
  private readonly trackedThreadIds = new Map<string, true>();
  private readonly ipcFrameListeners = new Set<
    (event: CodexIpcFrameEvent) => void
  >();
  private maxTrackedThreadCountSeen = 0;
  private maxTotalBufferedStreamEventCountSeen = 0;
  private maxBufferedStreamEventsPerThreadSeen = 0;
  private archivedRestoreHitCount = 0;
  private archivedRestoreFailureCount = 0;
  private streamParseFailureCount = 0;
  private streamReductionFailureCount = 0;
  private lastKnownOwnerClientId: string | null = null;

  private runtimeState: CodexAgentRuntimeState = {
    appReady: false,
    ipcConnected: false,
    ipcInitialized: false,
    codexAvailable: true,
    lastError: null,
  };

  private bootstrapInFlight: Promise<void> | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private started = false;

  public constructor(options: CodexAgentOptions) {
    this.onStateChange = options.onStateChange ?? null;
    this.reconnectDelayMs = options.reconnectDelayMs;

    this.appClient = new AppServerClient({
      executablePath: options.appExecutable,
      userAgent: options.userAgent,
      cwd: options.workspaceDir,
      onStderr: (line) => {
        const normalized = normalizeStderrLine(line);
        logger.error({ line: normalized }, "codex-app-server-stderr");
      },
    });

    this.ipcClient = new DesktopIpcClient({
      socketPath: options.socketPath,
    });
    this.service = new CodexMonitorService(this.ipcClient);

    this.ipcClient.onConnectionState((state) => {
      this.patchRuntimeState({
        ipcConnected: state.connected,
        ipcInitialized: state.connected
          ? this.runtimeState.ipcInitialized
          : false,
        ...(state.reason ? { lastError: state.reason } : {}),
      });

      if (!state.connected) {
        this.scheduleReconnect();
      } else if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
    });

    this.ipcClient.onFrame((frame) => {
      const threadId = extractThreadId(frame);
      const method =
        frame.type === "request" || frame.type === "broadcast"
          ? frame.method
          : frame.type === "response"
            ? (frame.method ?? "response")
            : frame.type;

      const sourceClientIdRaw =
        frame.type === "request" || frame.type === "broadcast"
          ? frame.sourceClientId
          : undefined;
      const sourceClientId =
        typeof sourceClientIdRaw === "string" ? sourceClientIdRaw.trim() : "";
      if (sourceClientId) {
        this.lastKnownOwnerClientId = sourceClientId;
      }

      this.emitIpcFrame({
        direction: "in",
        frame,
        method,
        threadId,
      });

      if (frame.type === "broadcast" && threadId) {
        const current = this.streamEventsByThreadId.get(threadId) ?? [];
        current.push(frame);
        if (current.length > MAX_STREAM_EVENTS_PER_THREAD) {
          current.splice(0, current.length - MAX_STREAM_EVENTS_PER_THREAD);
        }
        this.setTrackedThreadEvents(threadId, current);
      }

      if (
        frame.type !== "broadcast" ||
        frame.method !== "thread-stream-state-changed"
      ) {
        return;
      }

      const params = frame.params;
      if (!params || typeof params !== "object") {
        return;
      }

      const conversationId = (params as Record<string, string>)[
        "conversationId"
      ];
      if (!conversationId || !conversationId.trim()) {
        return;
      }

      if (sourceClientId) {
        this.setTrackedThreadOwner(conversationId, sourceClientId);
      }

      try {
        const parsedBroadcast = parseThreadStreamStateChangedBroadcast(frame);
        if (parsedBroadcast.params.change.type !== "snapshot") {
          return;
        }

        const snapshot = parsedBroadcast.params.change.conversationState;
        this.setTrackedThreadSnapshot(conversationId, snapshot, "stream");
        this.setThreadTitle(conversationId, snapshot.title);
      } catch (error) {
        logger.error(
          {
            conversationId,
            error: toErrorMessage(error),
            ...(error instanceof ProtocolValidationError
              ? { issues: error.issues }
              : {}),
          },
          "thread-stream-broadcast-parse-failed",
        );
      }
    });
  }

  public onIpcFrame(listener: (event: CodexIpcFrameEvent) => void): () => void {
    this.ipcFrameListeners.add(listener);
    return () => {
      this.ipcFrameListeners.delete(listener);
    };
  }

  public getRuntimeState(): CodexAgentRuntimeState {
    return { ...this.runtimeState };
  }

  public getThreadOwnerCount(): number {
    return this.threadOwnerById.size;
  }

  public getTrackedThreadRuntimeCounts(): {
    trackedThreadCount: number;
    streamEventThreadCount: number;
    totalBufferedStreamEventCount: number;
    streamSnapshotThreadCount: number;
    threadTitleCount: number;
    maxTrackedThreadCountSeen: number;
    maxTotalBufferedStreamEventCountSeen: number;
    maxBufferedStreamEventsPerThreadSeen: number;
    archivedRestoreHitCount: number;
    archivedRestoreFailureCount: number;
    streamParseFailureCount: number;
    streamReductionFailureCount: number;
  } {
    let totalBufferedStreamEventCount = 0;
    for (const events of this.streamEventsByThreadId.values()) {
      totalBufferedStreamEventCount += events.length;
    }

    return {
      trackedThreadCount: this.trackedThreadIds.size,
      streamEventThreadCount: this.streamEventsByThreadId.size,
      totalBufferedStreamEventCount,
      streamSnapshotThreadCount: this.streamSnapshotByThreadId.size,
      threadTitleCount: this.threadTitleById.size,
      maxTrackedThreadCountSeen: this.maxTrackedThreadCountSeen,
      maxTotalBufferedStreamEventCountSeen:
        this.maxTotalBufferedStreamEventCountSeen,
      maxBufferedStreamEventsPerThreadSeen:
        this.maxBufferedStreamEventsPerThreadSeen,
      archivedRestoreHitCount: this.archivedRestoreHitCount,
      archivedRestoreFailureCount: this.archivedRestoreFailureCount,
      streamParseFailureCount: this.streamParseFailureCount,
      streamReductionFailureCount: this.streamReductionFailureCount,
    };
  }

  public isEnabled(): boolean {
    return true;
  }

  public isConnected(): boolean {
    return this.runtimeState.codexAvailable && this.runtimeState.appReady;
  }

  public isIpcReady(): boolean {
    return this.runtimeState.ipcConnected && this.runtimeState.ipcInitialized;
  }

  public async start(): Promise<void> {
    this.started = true;
    await this.bootstrapConnections();
  }

  public async stop(): Promise<void> {
    this.started = false;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    await this.ipcClient.disconnect();
    await this.appClient.close();
  }

  public async listThreads(
    input: AgentListThreadsInput,
  ): Promise<AgentListThreadsResult> {
    this.ensureCodexAvailable();

    const result = await this.runAppServerCall(() =>
      input.all
        ? this.appClient.listThreadsAll(
            input.cursor
              ? {
                  limit: input.limit,
                  archived: input.archived,
                  cursor: input.cursor,
                  maxPages: input.maxPages,
                }
              : {
                  limit: input.limit,
                  archived: input.archived,
                  maxPages: input.maxPages,
                },
          )
        : this.appClient.listThreads(
            input.cursor
              ? {
                  limit: input.limit,
                  archived: input.archived,
                  cursor: input.cursor,
                }
              : {
                  limit: input.limit,
                  archived: input.archived,
                },
          ),
    );

    const data = result.data.map((thread) => {
      const title = this.resolveThreadTitle(thread.id, thread.title);
      const snapshot = this.streamSnapshotByThreadId.get(thread.id);
      const isGenerating = snapshot
        ? isThreadStateGenerating(snapshot)
        : undefined;
      const waitingState = snapshot ? deriveThreadWaitingState(snapshot) : null;
      const waitingFlags = waitingState
        ? {
            ...(waitingState.waitingOnApproval
              ? { waitingOnApproval: true }
              : {}),
            ...(waitingState.waitingOnUserInput
              ? { waitingOnUserInput: true }
              : {}),
          }
        : {};
      if (title === undefined) {
        if (
          isGenerating === undefined &&
          Object.keys(waitingFlags).length === 0
        ) {
          return thread;
        }
        return {
          ...thread,
          ...(isGenerating !== undefined ? { isGenerating } : {}),
          ...waitingFlags,
        };
      }

      return {
        ...thread,
        title,
        ...(isGenerating !== undefined ? { isGenerating } : {}),
        ...waitingFlags,
      };
    });

    return {
      data,
      nextCursor: result.nextCursor ?? null,
      ...(typeof result.pages === "number" ? { pages: result.pages } : {}),
      ...(typeof result.truncated === "boolean"
        ? { truncated: result.truncated }
        : {}),
    };
  }

  public async createThread(
    input: AgentCreateThreadInput,
  ): Promise<AgentCreateThreadResult> {
    this.ensureCodexAvailable();

    const cwd = input.cwd;
    if (!cwd || cwd.trim().length === 0) {
      throw new Error("Codex thread creation requires cwd");
    }

    const result = await this.runAppServerCall(() =>
      this.appClient.startThread({
        cwd,
        ...(input.model ? { model: input.model } : {}),
        ...(input.modelProvider ? { modelProvider: input.modelProvider } : {}),
        ...(input.personality ? { personality: input.personality } : {}),
        ...(input.sandbox ? { sandbox: input.sandbox } : {}),
        ...(input.approvalPolicy
          ? { approvalPolicy: input.approvalPolicy }
          : {}),
        ephemeral: input.ephemeral ?? false,
      }),
    );
    this.setThreadTitle(result.thread.id, result.thread.title);

    return {
      threadId: result.thread.id,
      thread: result.thread,
      model: result.model,
      modelProvider: result.modelProvider,
      cwd: result.cwd,
      approvalPolicy: result.approvalPolicy,
      sandbox: result.sandbox,
      reasoningEffort: result.reasoningEffort,
    };
  }

  public async readThread(
    input: AgentReadThreadInput,
  ): Promise<AgentReadThreadResult> {
    this.ensureCodexAvailable();
    const readThreadWithOption = async (includeTurns: boolean) => {
      return this.runAppServerCall(() =>
        this.appClient.readThread(input.threadId, includeTurns),
      );
    };

    let result: Awaited<ReturnType<typeof readThreadWithOption>>;
    try {
      try {
        result = await readThreadWithOption(input.includeTurns);
      } catch (error) {
        const typedError = error instanceof Error ? error : null;
        const shouldTryResume =
          isThreadNotLoadedAppServerRpcError(typedError) ||
          (input.includeTurns &&
            (isThreadNotMaterializedIncludeTurnsAppServerRpcError(typedError) ||
              isThreadNoRolloutIncludeTurnsAppServerRpcError(typedError)));
        if (!shouldTryResume) {
          throw error;
        }

        try {
          await this.resumeThread(input.threadId);
          result = await readThreadWithOption(input.includeTurns);
        } catch (resumeRetryError) {
          const typedResumeRetryError =
            resumeRetryError instanceof Error ? resumeRetryError : null;
          const shouldRetryWithoutTurns =
            input.includeTurns &&
            (isThreadNotMaterializedIncludeTurnsAppServerRpcError(
              typedResumeRetryError,
            ) ||
              isThreadNoRolloutIncludeTurnsAppServerRpcError(
                typedResumeRetryError,
              ));
          if (!shouldRetryWithoutTurns) {
            throw resumeRetryError;
          }
          result = await readThreadWithOption(false);
        }
      }
    } catch (error) {
      const restoredThread = await this.restoreArchivedThreadState(
        input.threadId,
        input.includeTurns,
      );
      if (!restoredThread) {
        throw error;
      }
      this.patchRuntimeState({
        lastError: null,
      });
      result = {
        thread: restoredThread,
      };
    }
    let parsedThread: ThreadConversationState;
    try {
      parsedThread = parseThreadConversationState(result.thread);
    } catch (error) {
      const restoredThread = await this.restoreArchivedThreadState(
        input.threadId,
        input.includeTurns,
      );
      if (!restoredThread) {
        throw error;
      }
      this.patchRuntimeState({
        lastError: null,
      });
      parsedThread = restoredThread;
    }
    const existingSnapshot = this.streamSnapshotByThreadId.get(input.threadId);
    const shouldStoreSnapshot =
      input.includeTurns ||
      parsedThread.turns.length > 0 ||
      existingSnapshot === undefined;
    if (shouldStoreSnapshot) {
      const snapshotOrigin: StreamSnapshotOrigin =
        input.includeTurns && parsedThread.turns.length > 0
          ? "readThreadWithTurns"
          : "readThread";
      this.setTrackedThreadSnapshot(input.threadId, parsedThread, snapshotOrigin);
    }
    this.setThreadTitle(input.threadId, parsedThread.title);
    this.patchRuntimeState({
      lastError: null,
    });
    return {
      thread: parsedThread,
    };
  }

  public async sendMessage(input: AgentSendMessageInput): Promise<void> {
    this.ensureCodexAvailable();
    const text = input.text.trim();
    if (text.length === 0) {
      throw new Error("Message text is required");
    }

    const ownerClientId = (() => {
      const mapped = this.threadOwnerById.get(input.threadId);
      if (mapped && mapped.trim().length > 0) {
        return mapped.trim();
      }
      if (input.ownerClientId && input.ownerClientId.trim().length > 0) {
        return input.ownerClientId.trim();
      }
      if (this.lastKnownOwnerClientId && this.lastKnownOwnerClientId.trim()) {
        return this.lastKnownOwnerClientId.trim();
      }
      return null;
    })();

    if (ownerClientId && this.isIpcReady()) {
      this.setTrackedThreadOwner(input.threadId, ownerClientId);
      try {
        await this.service.sendMessage({
          threadId: input.threadId,
          ownerClientId,
          text,
          ...(input.cwd ? { cwd: input.cwd } : {}),
          ...(typeof input.isSteering === "boolean"
            ? { isSteering: input.isSteering }
            : {}),
        });
        return;
      } catch (error) {
        const typedError = error instanceof Error ? error : null;
        if (!isIpcNoClientFoundError(typedError)) {
          throw error;
        }
        const mappedOwnerClientId = this.threadOwnerById.get(input.threadId);
        if (mappedOwnerClientId === ownerClientId) {
          this.threadOwnerById.delete(input.threadId);
        }
        if (this.lastKnownOwnerClientId === ownerClientId) {
          this.lastKnownOwnerClientId = null;
        }
        logger.info(
          {
            threadId: input.threadId,
            ownerClientId,
            error: toErrorMessage(error),
          },
          "thread-owner-unreachable-send-via-app-server",
        );
      }
    }

    const sendTurn = async (): Promise<void> => {
      if (input.isSteering === true) {
        const activeTurnId = await this.getActiveTurnId(input.threadId);
        if (!activeTurnId) {
          throw new Error("Cannot steer because there is no active turn");
        }

        await this.appClient.steerTurn({
          threadId: input.threadId,
          expectedTurnId: activeTurnId,
          input: [{ type: "text", text }],
        });
        return;
      }

      await this.appClient.startTurn({
        threadId: input.threadId,
        input: [{ type: "text", text }],
        ...(input.cwd ? { cwd: input.cwd } : {}),
        attachments: [],
      });
    };
    await this.runThreadOperationWithResumeRetry(input.threadId, sendTurn);
  }

  public async interrupt(input: AgentInterruptInput): Promise<void> {
    this.ensureCodexAvailable();

    const interruptTurn = async (): Promise<void> => {
      const activeTurnId = await this.getActiveTurnId(input.threadId);
      if (!activeTurnId) {
        return;
      }
      await this.appClient.interruptTurn(input.threadId, activeTurnId);
    };
    await this.runThreadOperationWithResumeRetry(input.threadId, interruptTurn);
  }

  public async listModels(limit: number) {
    this.ensureCodexAvailable();
    return this.runAppServerCall(() => this.appClient.listModels(limit));
  }

  public async listCollaborationModes() {
    this.ensureCodexAvailable();
    return this.runAppServerCall(() => this.appClient.listCollaborationModes());
  }

  public async readRateLimits(): Promise<
    import("@farfield/protocol").AppServerGetAccountRateLimitsResponse
  > {
    this.ensureCodexAvailable();
    return this.runAppServerCall(() => this.appClient.readAccountRateLimits());
  }

  public async setCollaborationMode(
    input: AgentSetCollaborationModeInput,
  ): Promise<{ ownerClientId: string }> {
    this.ensureCodexAvailable();
    this.ensureIpcReady();

    const ownerClientId = resolveOwnerClientId(
      this.threadOwnerById,
      input.threadId,
      input.ownerClientId,
      this.lastKnownOwnerClientId ?? undefined,
    );

    await this.service.setCollaborationMode({
      threadId: input.threadId,
      ownerClientId,
      collaborationMode: input.collaborationMode,
    });

    return {
      ownerClientId,
    };
  }

  public async submitUserInput(
    input: AgentSubmitUserInputInput,
  ): Promise<{ ownerClientId: string; requestId: UserInputRequestId }> {
    this.ensureCodexAvailable();
    const parsedResponse = parseUserInputResponsePayload(input.response);
    const ownerClientIdForResult = (() => {
      const mapped = this.threadOwnerById.get(input.threadId);
      if (mapped && mapped.trim().length > 0) {
        return mapped.trim();
      }
      if (input.ownerClientId && input.ownerClientId.trim().length > 0) {
        return input.ownerClientId.trim();
      }
      if (this.lastKnownOwnerClientId && this.lastKnownOwnerClientId.trim()) {
        return this.lastKnownOwnerClientId.trim();
      }
      return "app-server";
    })();

    const threadForRouting = await this.runThreadOperationWithResumeRetry(
      input.threadId,
      () => this.appClient.readThread(input.threadId, false),
    );
    const parsedRoutingThread = parseThreadConversationState(threadForRouting.thread);
    const routingPendingRequest = findPendingRequestWithId(
      parsedRoutingThread,
      input.requestId,
    );

    if (routingPendingRequest) {
      await this.runAppServerCall(() =>
        this.appClient.submitUserInput(input.requestId, parsedResponse),
      );

      const refreshedThread = await this.runThreadOperationWithResumeRetry(
        input.threadId,
        () => this.appClient.readThread(input.threadId, true),
      );
      const parsedThread = parseThreadConversationState(refreshedThread.thread);
      this.setThreadTitle(input.threadId, parsedThread.title);

      const currentEvents = this.streamEventsByThreadId.get(input.threadId) ?? [];
      currentEvents.push(
        buildSyntheticSnapshotEvent(input.threadId, ownerClientIdForResult, parsedThread),
      );
      if (currentEvents.length > MAX_STREAM_EVENTS_PER_THREAD) {
        currentEvents.splice(0, currentEvents.length - MAX_STREAM_EVENTS_PER_THREAD);
      }
      this.setTrackedThreadSnapshot(
        input.threadId,
        parsedThread,
        "readThreadWithTurns",
      );
      this.setTrackedThreadEvents(input.threadId, currentEvents);

      return {
        ownerClientId: ownerClientIdForResult,
        requestId: input.requestId,
      };
    }

    this.ensureIpcReady();
    const ownerClientId = resolveOwnerClientId(
      this.threadOwnerById,
      input.threadId,
      input.ownerClientId,
      this.lastKnownOwnerClientId ?? undefined,
    );
    this.setTrackedThreadOwner(input.threadId, ownerClientId);

    const pendingIpcRequest = await this.resolvePendingIpcRequest(
      input.threadId,
      input.requestId,
    );
    switch (pendingIpcRequest.method) {
      case "item/commandExecution/requestApproval": {
        const commandResponse =
          parseCommandExecutionRequestApprovalResponse(parsedResponse);
        await this.service.submitCommandApprovalDecision({
          threadId: input.threadId,
          ownerClientId,
          requestId: input.requestId,
          response: commandResponse,
        });
        break;
      }
      case "item/fileChange/requestApproval": {
        const fileResponse = parseFileChangeRequestApprovalResponse(
          parsedResponse,
        );
        await this.service.submitFileApprovalDecision({
          threadId: input.threadId,
          ownerClientId,
          requestId: input.requestId,
          response: fileResponse,
        });
        break;
      }
      case "item/tool/requestUserInput": {
        const toolResponse = parseToolRequestUserInputResponsePayload(
          parsedResponse,
        );
        await this.service.submitUserInput({
          threadId: input.threadId,
          ownerClientId,
          requestId: input.requestId,
          response: toolResponse,
        });
        break;
      }
      case "execCommandApproval":
      case "applyPatchApproval":
        throw new Error(
          `Legacy approval request method ${pendingIpcRequest.method} is not supported over desktop IPC for thread ${input.threadId}`,
        );
      case "account/chatgptAuthTokens/refresh":
      case "item/tool/call":
      case "item/plan/requestImplementation":
        throw new Error(
          `Unsupported pending request method ${pendingIpcRequest.method} for submitUserInput on thread ${input.threadId}`,
        );
    }

    return {
      ownerClientId,
      requestId: input.requestId,
    };
  }

  public async readLiveState(threadId: string): Promise<AgentThreadLiveState> {
    this.touchTrackedThread(threadId);
    let snapshotState = this.streamSnapshotByThreadId.get(threadId) ?? null;
    let snapshotOrigin =
      this.streamSnapshotOriginByThreadId.get(threadId) ?? null;
    const ownerClientId =
      this.threadOwnerById.get(threadId) ?? this.lastKnownOwnerClientId ?? null;
    const rawEvents = this.streamEventsByThreadId.get(threadId) ?? [];
    if (rawEvents.length === 0 && snapshotState === null) {
      const restoredState = await this.restoreArchivedThreadState(threadId, true);
      if (restoredState) {
        snapshotState = restoredState;
        snapshotOrigin = "readThreadWithTurns";
      }
    }
    if (rawEvents.length === 0) {
      return {
        ownerClientId,
        conversationState: snapshotState,
        liveStateError: null,
      };
    }

    const collectedEvents = collectThreadStreamStateChangedEvents(rawEvents);
    if (collectedEvents.parseError) {
      this.streamParseFailureCount += 1;
      logger.error(
        {
          threadId,
          eventIndex: collectedEvents.parseError.eventIndex,
          error: collectedEvents.parseError.message,
          ...(collectedEvents.parseError.issues
            ? { issues: collectedEvents.parseError.issues }
            : {}),
        },
        "thread-stream-event-parse-failed",
      );
      return {
        ownerClientId,
        conversationState: snapshotState,
        liveStateError: {
          kind: "parseFailed",
          message: collectedEvents.parseError.message,
          eventIndex: collectedEvents.parseError.eventIndex,
          patchIndex: null,
        },
      };
    }
    const events = collectedEvents.events;

    if (events.length === 0) {
      return {
        ownerClientId,
        conversationState: snapshotState,
        liveStateError: null,
      };
    }

    const reductionWindow = trimThreadStreamEventsForReduction(events);
    const reductionEvents = reductionWindow.events;
    const canUseSyntheticSnapshot =
      !reductionWindow.hasSnapshot &&
      snapshotState !== null &&
      snapshotOrigin === "stream";
    const hasReliableReductionBase =
      reductionWindow.hasSnapshot || canUseSyntheticSnapshot;

    if (!hasReliableReductionBase) {
      return {
        ownerClientId,
        conversationState: snapshotState,
        liveStateError: null,
      };
    }

    const reductionInput = canUseSyntheticSnapshot
      ? [
          buildSyntheticSnapshotEvent(
            threadId,
            ownerClientId ?? "farfield",
            snapshotState!,
          ),
          ...reductionEvents,
        ]
      : reductionEvents;
    try {
      const reduced = reduceThreadStreamEvents(reductionInput);
      const state = reduced.get(threadId);
      return {
        ownerClientId: state?.ownerClientId ?? ownerClientId ?? null,
        conversationState: state?.conversationState ?? snapshotState,
        liveStateError: null,
      };
    } catch (error) {
      this.streamReductionFailureCount += 1;
      const reductionErrorDetails =
        error instanceof ThreadStreamReductionError ? error.details : null;
      const eventIndex = reductionErrorDetails?.eventIndex ?? null;
      const patchIndex = reductionErrorDetails?.patchIndex ?? null;
      const message = toErrorMessage(error);

      logger.warn(
        {
          threadId,
          error: message,
          eventIndex,
          patchIndex,
        },
        "thread-stream-reduction-failed",
      );

      return {
        ownerClientId,
        conversationState: snapshotState,
        liveStateError: {
          kind: "reductionFailed",
          message,
          eventIndex,
          patchIndex,
        },
      };
    }
  }

  public async readStreamEvents(
    threadId: string,
    limit: number,
  ): Promise<AgentThreadStreamEvents> {
    this.touchTrackedThread(threadId);
    return {
      ownerClientId:
        this.threadOwnerById.get(threadId) ??
        this.lastKnownOwnerClientId ??
        null,
      events: (this.streamEventsByThreadId.get(threadId) ?? []).slice(-limit),
    };
  }

  public async replayRequest(
    method: string,
    params: IpcRequestFrame["params"],
    options: SendRequestOptions = {},
  ): Promise<IpcResponseFrame["result"]> {
    this.ensureIpcReady();
    const previewFrame: IpcFrame = {
      type: "request",
      requestId: "monitor-preview-request-id",
      method,
      params,
      targetClientId: options.targetClientId,
      version: options.version,
    };
    this.emitIpcFrame({
      direction: "out",
      frame: previewFrame,
      method,
      threadId: extractThreadId(previewFrame),
    });

    const response = await this.ipcClient.sendRequestAndWait(
      method,
      params,
      options,
    );
    return response.result;
  }

  public replayBroadcast(
    method: string,
    params: IpcRequestFrame["params"],
    options: SendRequestOptions = {},
  ): void {
    this.ensureIpcReady();
    const previewFrame: IpcFrame = {
      type: "broadcast",
      method,
      params,
      targetClientId: options.targetClientId,
      version: options.version,
    };
    this.emitIpcFrame({
      direction: "out",
      frame: previewFrame,
      method,
      threadId: extractThreadId({
        type: "request",
        requestId: "monitor-preview-request-id",
        method,
        params,
        targetClientId: options.targetClientId,
        version: options.version,
      }),
    });

    this.ipcClient.sendBroadcast(method, params, options);
  }

  private emitIpcFrame(event: CodexIpcFrameEvent): void {
    for (const listener of this.ipcFrameListeners) {
      listener(event);
    }
  }

  private notifyStateChanged(): void {
    if (this.onStateChange) {
      this.onStateChange();
    }
  }

  private setRuntimeState(next: CodexAgentRuntimeState): void {
    const isSameState =
      this.runtimeState.appReady === next.appReady &&
      this.runtimeState.ipcConnected === next.ipcConnected &&
      this.runtimeState.ipcInitialized === next.ipcInitialized &&
      this.runtimeState.codexAvailable === next.codexAvailable &&
      this.runtimeState.lastError === next.lastError;

    if (isSameState) {
      return;
    }

    this.runtimeState = next;
    this.notifyStateChanged();
  }

  protected patchRuntimeState(patch: Partial<CodexAgentRuntimeState>): void {
    this.setRuntimeState({
      ...this.runtimeState,
      ...patch,
    });
  }

  private ensureCodexAvailable(): void {
    if (!this.runtimeState.codexAvailable) {
      throw new Error("Codex backend is not available");
    }
  }

  private ensureIpcReady(): void {
    if (!this.isIpcReady()) {
      throw new Error(
        this.runtimeState.lastError ?? "Desktop IPC is not connected",
      );
    }
  }

  private scheduleReconnect(): void {
    if (
      this.reconnectTimer ||
      !this.runtimeState.codexAvailable ||
      !this.started
    ) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.bootstrapConnections();
    }, this.reconnectDelayMs);
  }

  private async runAppServerCall<T>(operation: () => Promise<T>): Promise<T> {
    try {
      const result = await operation();
      this.patchRuntimeState({
        appReady: true,
        lastError: null,
      });
      return result;
    } catch (error) {
      if (error instanceof AppServerTransportError) {
        this.scheduleReconnect();
      }
      this.patchRuntimeState({
        appReady: !(error instanceof AppServerTransportError),
        lastError: toErrorMessage(error),
      });
      throw error;
    }
  }

  private async bootstrapConnections(): Promise<void> {
    if (this.bootstrapInFlight) {
      return this.bootstrapInFlight;
    }

    this.bootstrapInFlight = (async () => {
      try {
        await this.runAppServerCall(() =>
          this.appClient.listThreads({ limit: 1, archived: false }),
        );
      } catch (error) {
        const message = toErrorMessage(error);
        const isSpawnError =
          message.includes("ENOENT") ||
          message.includes("not found") ||
          (error instanceof Error &&
            "code" in error &&
            (error as NodeJS.ErrnoException).code === "ENOENT");

        if (isSpawnError) {
          this.patchRuntimeState({
            codexAvailable: false,
            lastError: message,
          });
          logger.warn({ error: message }, "codex-not-found");
        } else {
          this.scheduleReconnect();
        }
      }

      if (!this.runtimeState.codexAvailable) {
        this.bootstrapInFlight = null;
        return;
      }

      try {
        if (!this.ipcClient.isConnected()) {
          await this.ipcClient.connect();
        }
        this.patchRuntimeState({
          ipcConnected: true,
        });

        await this.ipcClient.initialize(this.label);
        this.patchRuntimeState({
          ipcInitialized: true,
        });
      } catch (error) {
        this.patchRuntimeState({
          ipcInitialized: false,
          ipcConnected: this.ipcClient.isConnected(),
          lastError: toErrorMessage(error),
        });
        this.scheduleReconnect();
      } finally {
        this.bootstrapInFlight = null;
      }
    })();

    return this.bootstrapInFlight;
  }

  private async getActiveTurnId(threadId: string): Promise<string | null> {
    const readResult = await this.runAppServerCall(() =>
      this.appClient.readThread(threadId, true),
    );
    const turns = readResult.thread.turns;

    for (let index = turns.length - 1; index >= 0; index -= 1) {
      const turn = turns[index];
      if (!turn) {
        continue;
      }

      const status = turn.status.trim().toLowerCase();
      const isTerminal =
        status === "completed" ||
        status === "failed" ||
        status === "error" ||
        status === "cancelled" ||
        status === "canceled";
      if (isTerminal) {
        continue;
      }

      if (turn.turnId && turn.turnId.trim().length > 0) {
        return turn.turnId.trim();
      }

      if (turn.id && turn.id.trim().length > 0) {
        return turn.id.trim();
      }
    }

    return null;
  }

  private async resumeThread(threadId: string): Promise<void> {
    await this.runAppServerCall(() =>
      this.appClient.resumeThread(threadId, {
        persistExtendedHistory: true,
      }),
    );
  }

  protected async restoreArchivedThreadState(
    threadId: string,
    includeTurns: boolean,
  ): Promise<ThreadConversationState | null> {
    const rolloutPath = await findArchivedRolloutPath(threadId);
    if (!rolloutPath) {
      return null;
    }

    try {
      const content = await readFile(rolloutPath, "utf8");
      const metadata = await readThreadIndexMetadata(threadId);
      const restored = buildArchivedThreadConversationStateFromJsonl(
        content,
        threadId,
        metadata,
      );
      if (!restored) {
        this.archivedRestoreFailureCount += 1;
        return null;
      }

      const validated = parseThreadConversationState(restored);
      const normalized = includeTurns
        ? validated
        : {
            ...validated,
            turns: [],
          };
      if (validated.turns.length > 0) {
        this.setTrackedThreadSnapshot(
          threadId,
          validated,
          "readThreadWithTurns",
        );
      }
      this.setThreadTitle(threadId, normalized.title);
      this.archivedRestoreHitCount += 1;
      return normalized;
    } catch (error) {
      this.archivedRestoreFailureCount += 1;
      logger.warn(
        {
          threadId,
          rolloutPath,
          error: toErrorMessage(error),
        },
        "archived-thread-restore-failed",
      );
      return null;
    }
  }

  private async isThreadLoaded(threadId: string): Promise<boolean> {
    let cursor: string | null = null;

    while (true) {
      const response = await this.runAppServerCall(() =>
        this.appClient.listLoadedThreads({
          limit: 200,
          ...(cursor ? { cursor } : {}),
        }),
      );
      if (response.data.some((loadedThreadId) => loadedThreadId === threadId)) {
        return true;
      }

      const nextCursor = response.nextCursor ?? null;
      if (!nextCursor) {
        return false;
      }
      cursor = nextCursor;
    }
  }

  private async ensureThreadLoaded(threadId: string): Promise<void> {
    if (await this.isThreadLoaded(threadId)) {
      return;
    }

    await this.resumeThread(threadId);
  }

  private async runThreadOperationWithResumeRetry<T>(
    threadId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    await this.ensureThreadLoaded(threadId);

    try {
      return await this.runAppServerCall(operation);
    } catch (error) {
      const typedError = error instanceof Error ? error : null;
      if (!isInvalidRequestAppServerRpcError(typedError)) {
        throw error;
      }

      const stillLoaded = await this.isThreadLoaded(threadId);
      if (stillLoaded) {
        throw error;
      }
    }

    await this.resumeThread(threadId);
    return this.runAppServerCall(operation);
  }

  private async resolvePendingIpcRequest(
    threadId: string,
    requestId: UserInputRequestId,
  ): Promise<ThreadConversationRequest> {
    const cachedSnapshot = this.streamSnapshotByThreadId.get(threadId);
    if (cachedSnapshot) {
      const pending = findPendingRequestWithId(cachedSnapshot, requestId);
      if (pending) {
        return pending;
      }
    }

    const liveState = await this.readLiveState(threadId);
    if (liveState.conversationState) {
      const pending = findPendingRequestWithId(
        liveState.conversationState,
        requestId,
      );
      if (pending) {
        return pending;
      }
    }

    throw new Error(
      `Unable to find pending request ${String(requestId)} in live state for thread ${threadId}`,
    );
  }

  private resolveThreadTitle(
    threadId: string,
    directTitle: string | null | undefined,
  ): string | null | undefined {
    if (directTitle !== undefined) {
      return directTitle;
    }

    if (this.threadTitleById.has(threadId)) {
      return this.threadTitleById.get(threadId);
    }

    const snapshot = this.streamSnapshotByThreadId.get(threadId);
    if (!snapshot) {
      return undefined;
    }

    return snapshot.title;
  }

  private touchTrackedThread(threadId: string): void {
    const normalized = threadId.trim();
    if (normalized.length === 0) {
      return;
    }
    if (this.trackedThreadIds.has(normalized)) {
      this.trackedThreadIds.delete(normalized);
    }
    this.trackedThreadIds.set(normalized, true);
    while (this.trackedThreadIds.size > MAX_TRACKED_THREAD_RUNTIME_STATES) {
      const oldestThreadId = this.trackedThreadIds.keys().next().value;
      if (typeof oldestThreadId !== "string") {
        return;
      }
      this.trackedThreadIds.delete(oldestThreadId);
      this.threadOwnerById.delete(oldestThreadId);
      this.streamEventsByThreadId.delete(oldestThreadId);
      this.streamSnapshotByThreadId.delete(oldestThreadId);
      this.streamSnapshotOriginByThreadId.delete(oldestThreadId);
      this.threadTitleById.delete(oldestThreadId);
    }
    this.updateRuntimeHighWaterMarks();
  }

  protected setTrackedThreadOwner(threadId: string, ownerClientId: string): void {
    this.touchTrackedThread(threadId);
    this.threadOwnerById.set(threadId, ownerClientId);
  }

  protected setTrackedThreadEvents(threadId: string, events: IpcFrame[]): void {
    this.touchTrackedThread(threadId);
    this.streamEventsByThreadId.set(
      threadId,
      events.slice(-MAX_STREAM_EVENTS_PER_THREAD),
    );
    this.updateRuntimeHighWaterMarks();
  }

  protected setTrackedThreadSnapshot(
    threadId: string,
    snapshot: ThreadConversationState,
    origin: StreamSnapshotOrigin,
  ): void {
    this.touchTrackedThread(threadId);
    this.streamSnapshotByThreadId.set(threadId, snapshot);
    this.streamSnapshotOriginByThreadId.set(threadId, origin);
  }

  protected setThreadTitle(
    threadId: string,
    title: string | null | undefined,
  ): void {
    this.touchTrackedThread(threadId);
    if (title === undefined) {
      this.threadTitleById.delete(threadId);
      return;
    }

    if (title === null) {
      this.threadTitleById.set(threadId, null);
      return;
    }

    const normalized = title.trim();
    if (normalized.length === 0) {
      this.threadTitleById.set(threadId, null);
      return;
    }

    this.threadTitleById.set(threadId, title);
  }

  private updateRuntimeHighWaterMarks(): void {
    this.maxTrackedThreadCountSeen = Math.max(
      this.maxTrackedThreadCountSeen,
      this.trackedThreadIds.size,
    );

    let totalBufferedStreamEventCount = 0;
    let maxBufferedStreamEventsPerThread = 0;
    for (const events of this.streamEventsByThreadId.values()) {
      totalBufferedStreamEventCount += events.length;
      maxBufferedStreamEventsPerThread = Math.max(
        maxBufferedStreamEventsPerThread,
        events.length,
      );
    }

    this.maxTotalBufferedStreamEventCountSeen = Math.max(
      this.maxTotalBufferedStreamEventCountSeen,
      totalBufferedStreamEventCount,
    );
    this.maxBufferedStreamEventsPerThreadSeen = Math.max(
      this.maxBufferedStreamEventsPerThreadSeen,
      maxBufferedStreamEventsPerThread,
    );
  }
}

function toErrorMessage(error: Error | string | unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return String(error);
}

export function collectThreadStreamStateChangedEvents(rawEvents: IpcFrame[]): {
  events: ThreadStreamStateChangedBroadcast[];
  parseError:
    | {
        eventIndex: number;
        message: string;
        issues?: ProtocolValidationError["issues"];
      }
    | null;
} {
  const events: ThreadStreamStateChangedBroadcast[] = [];

  for (let eventIndex = 0; eventIndex < rawEvents.length; eventIndex += 1) {
    const event = rawEvents[eventIndex];
    if (!event) {
      continue;
    }
    if (
      event.type !== "broadcast" ||
      event.method !== "thread-stream-state-changed"
    ) {
      continue;
    }

    try {
      events.push(parseThreadStreamStateChangedBroadcast(event));
    } catch (error) {
      return {
        events,
        parseError: {
          eventIndex,
          message: toErrorMessage(error),
          ...(error instanceof ProtocolValidationError
            ? { issues: error.issues }
            : {}),
        },
      };
    }
  }

  return {
    events,
    parseError: null,
  };
}

interface ArchivedThreadIndexMetadata {
  title: string | null;
  updatedAt: number | null;
}

interface ArchivedSessionEntry {
  timestamp?: string;
  type?: string;
  payload?: Record<string, ArchivedJsonValue>;
}

export function buildArchivedThreadConversationStateFromJsonl(
  content: string,
  threadId: string,
  metadata?: ArchivedThreadIndexMetadata | null,
): ThreadConversationState | null {
  const entries: ArchivedSessionEntry[] = [];
  const lines = content.split(/\r?\n/);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const trimmed = line?.trim() ?? "";
    if (trimmed.length === 0) {
      continue;
    }

    try {
      entries.push(JSON.parse(trimmed) as ArchivedSessionEntry);
    } catch (error) {
      logArchivedMalformedJsonlLine(
        threadId,
        lineIndex,
        toErrorMessage(error),
        lineIndex === lines.length - 1,
      );
    }
  }

  if (entries.length === 0) {
    return null;
  }

  let itemCounter = 0;
  let createdAt = Number.POSITIVE_INFINITY;
  let updatedAt = 0;
  let cwd: string | undefined;
  let source: string | undefined;
  let title = metadata?.title ?? null;
  let latestModel: string | null = null;
  let latestReasoningEffort: string | null = null;
  let latestTokenUsageInfo: ThreadConversationState["latestTokenUsageInfo"];
  let currentTurn: ThreadConversationState["turns"][number] | null = null;
  const turns: ThreadConversationState["turns"] = [];
  const archivedToolCallsById = new Map<string, ArchivedDynamicToolCallItem>();

  const nextItemId = () => `archived-item-${String(++itemCounter)}`;

  const ensureTurn = () => {
    if (currentTurn) {
      return currentTurn;
    }

    currentTurn = {
      id: `archived-turn-${String(turns.length + 1)}`,
      status: "completed",
      items: [],
    };
    turns.push(currentTurn);
    return currentTurn;
  };

  const finalizeTurn = (
    turnId: string | null | undefined,
    completedAtMs: number | null,
  ) => {
    if (!currentTurn) {
      return;
    }
    if (turnId && !currentTurn.turnId) {
      currentTurn.turnId = turnId;
    }
    currentTurn.status = "completed";
    if (
      completedAtMs !== null &&
      currentTurn.finalAssistantStartedAtMs === undefined
    ) {
      currentTurn.finalAssistantStartedAtMs = completedAtMs;
    }
    currentTurn = null;
  };

  const ensureArchivedToolCall = (
    callId: string,
    tool: unknown,
    argumentsValue: unknown,
    status: ArchivedDynamicToolCallItem["status"] = "inProgress",
  ): ArchivedDynamicToolCallItem => {
    const normalizedTool = normalizeArchivedToolName(tool);
    const existing = archivedToolCallsById.get(callId);
    if (existing) {
      if (existing.tool === "legacyTool" && normalizedTool !== "legacyTool") {
        existing.tool = normalizedTool;
      }
      if (argumentsValue !== undefined) {
        existing.arguments = normalizeArchivedToolArguments(argumentsValue);
      }
      if (status !== "inProgress" || existing.status === "inProgress") {
        existing.status = status;
      }
      return existing;
    }

    const turn = ensureTurn();
    const item: ArchivedDynamicToolCallItem = {
      id: nextItemId(),
      type: "dynamicToolCall",
      tool: normalizedTool,
      arguments: normalizeArchivedToolArguments(argumentsValue),
      status,
    };
    turn.items.push(item);
    archivedToolCallsById.set(callId, item);
    return item;
  };

  for (const entry of entries) {
    const timestampSeconds = parseTimestampToUnixSeconds(entry.timestamp);
    if (timestampSeconds !== null) {
      createdAt = Math.min(createdAt, timestampSeconds);
      updatedAt = Math.max(updatedAt, timestampSeconds);
    }

    const payload = entry.payload;
    const payloadType = payload?.["type"];
    if (!payload || typeof payloadType !== "string") {
      continue;
    }

    switch (payloadType) {
      case "session_meta": {
        const payloadCwd = payload["cwd"];
        if (typeof payloadCwd === "string" && payloadCwd.trim().length > 0) {
          cwd = payloadCwd;
        }
        const payloadSource = payload["source"];
        if (
          typeof payloadSource === "string" &&
          payloadSource.trim().length > 0
        ) {
          source = payloadSource;
        }
        title = readArchivedString(payload, [
          "thread_name",
          "threadName",
          "title",
          "name",
        ]) ?? title;
        latestModel =
          readArchivedString(payload, ["model", "latestModel", "model_name"]) ??
          latestModel;
        latestReasoningEffort =
          readArchivedString(payload, [
            "reasoning_effort",
            "reasoningEffort",
            "effort",
          ]) ?? latestReasoningEffort;
        break;
      }

      case "task_started": {
        if (currentTurn) {
          finalizeTurn(null, null);
        }
        const payloadTurnId = payload["turn_id"];
        currentTurn = {
          id: `archived-turn-${String(turns.length + 1)}`,
          ...(typeof payloadTurnId === "string" && payloadTurnId.trim()
            ? { turnId: payloadTurnId }
            : {}),
          status: "inProgress",
          ...(timestampSeconds !== null
            ? { turnStartedAtMs: timestampSeconds * 1000 }
            : {}),
          items: [],
        };
        turns.push(currentTurn);
        latestModel =
          readArchivedString(payload, ["model", "latestModel", "model_name"]) ??
          latestModel;
        latestReasoningEffort =
          readArchivedString(payload, [
            "reasoning_effort",
            "reasoningEffort",
            "effort",
          ]) ?? latestReasoningEffort;
        break;
      }

      case "user_message": {
        const turn = ensureTurn();
        const contentItems: ThreadConversationState["turns"][number]["items"][number] &
          { type: "userMessage" } = {
          id: nextItemId(),
          type: "userMessage",
          content: [],
        };

        const payloadMessage = payload["message"];
        if (typeof payloadMessage === "string" && payloadMessage.length > 0) {
          contentItems.content.push({
            type: "text",
            text: payloadMessage,
          });
        }

        const payloadImages = payload["images"];
        if (Array.isArray(payloadImages)) {
          for (const image of payloadImages) {
            if (typeof image === "string" && image.trim().length > 0) {
              contentItems.content.push({
                type: "image",
                url: image,
              });
            }
          }
        }

        if (contentItems.content.length > 0) {
          turn.items.push(contentItems);
        }
        break;
      }

      case "message": {
        const role = readArchivedString(payload, ["role"]);
        if (!role) {
          break;
        }

        if (role === "assistant") {
          const text = normalizeArchivedAssistantMessageText(payload["content"]);
          if (!text) {
            break;
          }
          const turn = ensureTurn();
          const payloadPhase = payload["phase"];
          turn.items.push({
            id: nextItemId(),
            type: "agentMessage",
            text,
            ...(typeof payloadPhase === "string" ? { phase: payloadPhase } : {}),
          });
          break;
        }

        const content = normalizeArchivedMessageContent(payload["content"]);
        if (content.length === 0) {
          break;
        }

        const turn = ensureTurn();
        if (role === "developer" || role === "system") {
          turn.items.push({
            id: nextItemId(),
            type: "steeringUserMessage",
            content,
          });
          break;
        }

        turn.items.push({
          id: nextItemId(),
          type: "userMessage",
          content,
        });
        break;
      }

      case "agent_message": {
        const payloadMessage = payload["message"];
        if (typeof payloadMessage !== "string" || payloadMessage.length === 0) {
          break;
        }
        const turn = ensureTurn();
        const payloadPhase = payload["phase"];
        turn.items.push({
          id: nextItemId(),
          type: "agentMessage",
          text: payloadMessage,
          ...(typeof payloadPhase === "string" ? { phase: payloadPhase } : {}),
        });
        break;
      }

      case "reasoning": {
        const payloadSummary = payload["summary"];
        const summary = Array.isArray(payloadSummary)
          ? payloadSummary.filter(
              (entry): entry is string => typeof entry === "string",
            )
          : [];
        if (summary.length === 0) {
          break;
        }
        const turn = ensureTurn();
        turn.items.push({
          id: nextItemId(),
          type: "reasoning",
          summary,
        });
        break;
      }

      case "agent_reasoning": {
        const payloadText = readArchivedString(payload, ["text", "message"]);
        const turn = ensureTurn();
        const payloadSummary = payload["summary"];
        const summary = Array.isArray(payloadSummary)
          ? payloadSummary.filter(
              (entry): entry is string => typeof entry === "string",
            )
          : [];
        if (summary.length === 0 && !payloadText) {
          break;
        }
        turn.items.push({
          id: nextItemId(),
          type: "reasoning",
          ...(summary.length > 0 ? { summary } : {}),
          ...(payloadText ? { text: payloadText } : {}),
        });
        break;
      }

      case "context_compacted":
      case "compacted": {
        const turn = ensureTurn();
        turn.items.push({
          id: nextItemId(),
          type: "contextCompaction",
          completed: true,
        });
        break;
      }

      case "token_count": {
        const payloadInfo = payload["info"];
        if (payloadInfo !== undefined) {
          latestTokenUsageInfo = payloadInfo;
        }
        break;
      }

      case "web_search_call": {
        const callId =
          readArchivedString(payload, ["call_id", "callId"]) ??
          `archived-web-search-${entry.timestamp ?? String(itemCounter + 1)}`;
        const action = payload["action"];
        const item = ensureArchivedToolCall(
          callId,
          "web_search",
          action ?? payload,
          normalizeArchivedToolStatus(payload["status"], null, "completed"),
        );
        const contentItems = normalizeArchivedToolContentItems(
          normalizeArchivedWebSearchContent(action),
        );
        if (contentItems) {
          item.contentItems = contentItems;
        }
        break;
      }

      case "function_call": {
        const callId = readArchivedString(payload, ["call_id", "callId"]);
        if (!callId) {
          break;
        }
        ensureArchivedToolCall(callId, payload["name"], payload["arguments"]);
        break;
      }

      case "function_call_output": {
        const callId = readArchivedString(payload, ["call_id", "callId"]);
        if (!callId) {
          break;
        }
        const output = payload["output"];
        const success = normalizeArchivedToolSuccess(output, true);
        const item = ensureArchivedToolCall(
          callId,
          payload["name"],
          undefined,
          normalizeArchivedToolStatus(undefined, success, "completed"),
        );
        const contentItems = normalizeArchivedToolContentItems(output);
        if (contentItems) {
          item.contentItems = contentItems;
        }
        if (success !== null) {
          item.success = success;
        }
        break;
      }

      case "custom_tool_call": {
        const callId = readArchivedString(payload, ["call_id", "callId"]);
        if (!callId) {
          break;
        }
        ensureArchivedToolCall(
          callId,
          payload["name"],
          payload["input"],
          normalizeArchivedToolStatus(payload["status"], null, "inProgress"),
        );
        break;
      }

      case "custom_tool_call_output": {
        const callId = readArchivedString(payload, ["call_id", "callId"]);
        if (!callId) {
          break;
        }
        const output = payload["output"];
        const success = normalizeArchivedToolSuccess(output, true);
        const item = ensureArchivedToolCall(
          callId,
          payload["name"],
          undefined,
          normalizeArchivedToolStatus(undefined, success, "completed"),
        );
        const contentItems = normalizeArchivedToolContentItems(output);
        if (contentItems) {
          item.contentItems = contentItems;
        }
        if (success !== null) {
          item.success = success;
        }
        break;
      }

      case "dynamic_tool_call_request": {
        const callId = readArchivedString(payload, ["call_id", "callId"]);
        if (!callId) {
          break;
        }
        ensureArchivedToolCall(callId, payload["tool"], payload["arguments"]);
        break;
      }

      case "dynamic_tool_call_response": {
        const callId = readArchivedString(payload, ["call_id", "callId"]);
        if (!callId) {
          break;
        }
        const errorText = readArchivedString(payload, ["error"]);
        const success = normalizeArchivedToolSuccess(
          payload["success"],
          errorText ? false : null,
        );
        const item = ensureArchivedToolCall(
          callId,
          payload["tool"],
          payload["arguments"],
          normalizeArchivedToolStatus(payload["status"], success, "completed"),
        );
        const contentItems =
          normalizeArchivedToolContentItems(payload["content_items"]) ??
          (errorText
            ? [
                {
                  type: "inputText",
                  text: truncateArchivedTextPreview(
                    errorText,
                    ARCHIVED_TOOL_TEXT_PREVIEW_MAX_CHARS,
                  ),
                },
              ]
            : null);
        if (contentItems) {
          item.contentItems = contentItems;
        }
        if (success !== null) {
          item.success = success;
        }
        const durationMs = parseArchivedDurationToMs(payload["duration"]);
        if (durationMs !== null) {
          item.durationMs = durationMs;
        }
        break;
      }

      case "todo_list":
      case "todo-list":
      case "todoList":
      case "plan_update": {
        const plan = normalizeArchivedTodoPlan(payload["plan"]);
        if (plan.length === 0) {
          break;
        }
        const explanation = payload["explanation"];
        const turn = ensureTurn();
        turn.items.push({
          id: nextItemId(),
          type: "todoList",
          ...(typeof explanation === "string" || explanation === null
            ? { explanation }
            : {}),
          plan,
        });
        break;
      }

      case "thread_name_updated": {
        title =
          readArchivedString(payload, [
            "thread_name",
            "threadName",
            "title",
            "name",
          ]) ?? title;
        break;
      }

      case "task_complete": {
        const payloadTurnId = payload["turn_id"];
        finalizeTurn(
          typeof payloadTurnId === "string" ? payloadTurnId : null,
          timestampSeconds !== null ? timestampSeconds * 1000 : null,
        );
        break;
      }

      default:
        logArchivedUnknownPayloadType(threadId, payloadType);
        break;
    }
  }

  if (currentTurn) {
    currentTurn.status = "completed";
    currentTurn = null;
  }

  if (turns.length === 0 && latestTokenUsageInfo === undefined) {
    return null;
  }

  const normalizedCreatedAt = Number.isFinite(createdAt)
    ? createdAt
    : metadata?.updatedAt ?? 0;
  const normalizedUpdatedAt =
    updatedAt > 0 ? updatedAt : metadata?.updatedAt ?? normalizedCreatedAt;

  return {
    id: threadId,
    turns,
    requests: [],
    ...(normalizedCreatedAt > 0 ? { createdAt: normalizedCreatedAt } : {}),
    ...(normalizedUpdatedAt > 0 ? { updatedAt: normalizedUpdatedAt } : {}),
    ...(title !== undefined ? { title } : {}),
    latestModel,
    latestReasoningEffort,
    ...(cwd ? { cwd } : {}),
    ...(source ? { source } : {}),
    ...(latestTokenUsageInfo !== undefined ? { latestTokenUsageInfo } : {}),
  };
}

function readArchivedString(
  payload: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value !== "string") {
      continue;
    }
    const normalized = value.trim();
    if (normalized.length > 0) {
      return normalized;
    }
  }
  return null;
}

function logArchivedUnknownPayloadType(
  threadId: string,
  payloadType: string,
): void {
  if (loggedArchivedUnknownPayloadTypes.has(payloadType)) {
    return;
  }
  loggedArchivedUnknownPayloadTypes.add(payloadType);
  logger.warn(
    {
      threadId,
      payloadType,
    },
    "archived-thread-unknown-payload-type",
  );
}

function logArchivedMalformedJsonlLine(
  threadId: string,
  lineIndex: number,
  error: string,
  truncatedTailCandidate: boolean,
): void {
  const key = `${threadId}:${String(lineIndex)}`;
  if (loggedArchivedMalformedJsonlLineKeys.has(key)) {
    return;
  }
  loggedArchivedMalformedJsonlLineKeys.add(key);
  logger.warn(
    {
      threadId,
      lineIndex,
      error,
      truncatedTailCandidate,
    },
    "archived-thread-jsonl-line-parse-failed",
  );
}

function normalizeArchivedMessageContent(
  value: unknown,
): Array<{ type: "text"; text: string } | { type: "image"; url: string }> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap<{ type: "text"; text: string } | { type: "image"; url: string }>((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }

    const record = entry as Record<string, unknown>;
    const rawType = readArchivedString(record, ["type"]);
    if (!rawType) {
      return [];
    }

    switch (rawType) {
      case "input_text":
      case "output_text": {
        const text = readArchivedString(record, ["text"]);
        return text
          ? [
              {
                type: "text",
                text,
              },
            ]
          : [];
      }

      case "input_image":
      case "output_image": {
        const url = readArchivedString(record, ["image_url", "imageUrl", "url"]);
        return url
          ? [
              {
                type: "image",
                url,
              },
            ]
          : [];
      }

      default:
        return [];
    }
  });
}

function normalizeArchivedAssistantMessageText(value: unknown): string | null {
  const textParts = normalizeArchivedMessageContent(value)
    .filter((item): item is { type: "text"; text: string } => item.type === "text")
    .map((item) => item.text);
  if (textParts.length === 0) {
    return null;
  }
  return textParts.join("\n\n");
}

function normalizeArchivedToolName(value: unknown): string {
  if (typeof value !== "string") {
    return "legacyTool";
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : "legacyTool";
}

function normalizeArchivedToolArguments(value: unknown): ArchivedJsonValue {
  if (typeof value === "string") {
    const parsed = tryParseArchivedJson(value);
    if (parsed !== undefined) {
      return normalizeArchivedToolJsonValue(parsed);
    }
  }
  return normalizeArchivedToolJsonValue(value);
}

function normalizeArchivedToolJsonValue(
  value: unknown,
  maxLength = ARCHIVED_TOOL_ARGUMENT_PREVIEW_MAX_CHARS,
): ArchivedJsonValue {
  const jsonValue = coerceArchivedJsonValue(value);
  if (jsonValue === undefined) {
    return truncateArchivedTextPreview(String(value), maxLength);
  }

  const serialized =
    typeof jsonValue === "string" ? jsonValue : JSON.stringify(jsonValue);
  if (!serialized || serialized.length <= maxLength) {
    return jsonValue;
  }

  return `${serialized.slice(0, maxLength)}...`;
}

function coerceArchivedJsonValue(value: unknown): ArchivedJsonValue | undefined {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    const result: ArchivedJsonValue[] = [];
    for (const entry of value) {
      const normalized = coerceArchivedJsonValue(entry);
      if (normalized === undefined) {
        continue;
      }
      result.push(normalized);
    }
    return result;
  }

  if (typeof value !== "object") {
    return undefined;
  }

  const result: Record<string, ArchivedJsonValue> = {};
  for (const [key, nestedValue] of Object.entries(
    value as Record<string, unknown>,
  )) {
    const normalized = coerceArchivedJsonValue(nestedValue);
    if (normalized === undefined) {
      continue;
    }
    result[key] = normalized;
  }
  return result;
}

function tryParseArchivedJson(value: string): unknown | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  if (!/^[{\["0-9tfn-]/.test(trimmed)) {
    return undefined;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function normalizeArchivedToolSuccess(
  value: unknown,
  fallback: boolean | null,
): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }

  if (value && typeof value === "object") {
    const nestedSuccess = (value as Record<string, unknown>)["success"];
    if (typeof nestedSuccess === "boolean") {
      return nestedSuccess;
    }
  }

  return fallback;
}

function normalizeArchivedToolStatus(
  value: unknown,
  success: boolean | null,
  fallback: ArchivedDynamicToolCallItem["status"],
): ArchivedDynamicToolCallItem["status"] {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase().replace(/[-_\s]+/g, "");
    if (
      normalized === "inprogress" ||
      normalized === "running" ||
      normalized === "pending"
    ) {
      return "inProgress";
    }
    if (
      normalized === "completed" ||
      normalized === "complete" ||
      normalized === "success" ||
      normalized === "succeeded"
    ) {
      return "completed";
    }
    if (
      normalized === "failed" ||
      normalized === "failure" ||
      normalized === "error" ||
      normalized === "errored"
    ) {
      return "failed";
    }
  }

  if (success === true) {
    return "completed";
  }
  if (success === false) {
    return "failed";
  }
  return fallback;
}

function normalizeArchivedToolContentItems(
  value: unknown,
): ArchivedDynamicToolContentItem[] | null {
  const body =
    value && typeof value === "object" && !Array.isArray(value)
      ? ((value as Record<string, unknown>)["body"] ?? value)
      : value;

  if (Array.isArray(body)) {
    const items = body
      .map(normalizeArchivedToolContentItem)
      .filter(
        (item): item is ArchivedDynamicToolContentItem => item !== null,
      );
    return items.length > 0 ? items : null;
  }

  if (body === null || body === undefined) {
    return null;
  }

  return [normalizeFallbackArchivedToolContentItem(body)];
}

function normalizeArchivedToolContentItem(
  value: unknown,
): ArchivedDynamicToolContentItem | null {
  if (!value || typeof value !== "object") {
    return normalizeFallbackArchivedToolContentItem(value);
  }

  const record = value as Record<string, unknown>;
  const rawType = readArchivedString(record, ["type"]);
  if (!rawType) {
    return normalizeFallbackArchivedToolContentItem(value);
  }

  switch (rawType) {
    case "inputText":
    case "input_text": {
      const text = readArchivedString(record, ["text"]);
      if (!text) {
        return null;
      }
      return {
        type: "inputText",
        text: truncateArchivedTextPreview(
          text,
          ARCHIVED_TOOL_TEXT_PREVIEW_MAX_CHARS,
        ),
      };
    }

    case "inputImage":
    case "input_image": {
      const imageUrl = readArchivedString(record, ["imageUrl", "image_url"]);
      if (!imageUrl) {
        return null;
      }
      return {
        type: "inputImage",
        imageUrl,
      };
    }

    default:
      return normalizeFallbackArchivedToolContentItem(value);
  }
}

function normalizeFallbackArchivedToolContentItem(
  value: unknown,
): ArchivedDynamicToolContentItem {
  return {
    type: "inputText",
    text: truncateArchivedTextPreview(
      typeof value === "string" ? value : JSON.stringify(value),
      ARCHIVED_TOOL_TEXT_PREVIEW_MAX_CHARS,
    ),
  };
}

function normalizeArchivedWebSearchContent(
  value: unknown,
): Array<{ type: "inputText"; text: string }> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const query = readArchivedString(record, ["query"]);
  const queriesValue = record["queries"];
  const queries = Array.isArray(queriesValue)
    ? queriesValue.filter(
        (entry): entry is string =>
          typeof entry === "string" && entry.trim().length > 0,
      )
    : [];
  const lines = query ? [query, ...queries] : queries;
  const uniqueLines = [...new Set(lines)];
  if (uniqueLines.length === 0) {
    return null;
  }

  return uniqueLines.map((line) => ({
    type: "inputText",
    text: truncateArchivedTextPreview(
      line,
      ARCHIVED_TOOL_TEXT_PREVIEW_MAX_CHARS,
    ),
  }));
}

function truncateArchivedTextPreview(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...`;
}

function normalizeArchivedTodoPlan(
  value: unknown,
): ArchivedTodoListItem["plan"] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const record = entry as Record<string, unknown>;
    const step = readArchivedString(record, ["step"]);
    const status = readArchivedString(record, ["status"]);
    if (!step || !status) {
      return [];
    }
    return [{ step, status }];
  });
}

function parseArchivedDurationToMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.round(value);
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const numeric = Number(trimmed);
  if (Number.isFinite(numeric) && numeric >= 0) {
    return Math.round(numeric);
  }

  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i.exec(
    trimmed,
  );
  if (!match) {
    return null;
  }

  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  const seconds = Number(match[3] ?? 0);
  if (
    !Number.isFinite(hours) ||
    !Number.isFinite(minutes) ||
    !Number.isFinite(seconds)
  ) {
    return null;
  }
  return Math.round(((hours * 60 * 60) + (minutes * 60) + seconds) * 1000);
}

const INVALID_REQUEST_ERROR_CODE = -32600;

export function isInvalidRequestAppServerRpcError(
  error: Error | null,
): boolean {
  if (!(error instanceof AppServerRpcError)) {
    return false;
  }
  return error.code === INVALID_REQUEST_ERROR_CODE;
}

export function isThreadNotMaterializedIncludeTurnsAppServerRpcError(
  error: Error | null,
): boolean {
  if (!isInvalidRequestAppServerRpcError(error)) {
    return false;
  }
  if (!error) {
    return false;
  }
  const normalized = error.message.trim().toLowerCase();
  return (
    normalized.includes("not materialized yet") &&
    normalized.includes("includeturns")
  );
}

export function isThreadNotLoadedAppServerRpcError(
  error: Error | null,
): boolean {
  if (!isInvalidRequestAppServerRpcError(error)) {
    return false;
  }
  if (!error) {
    return false;
  }
  const normalized = error.message.trim().toLowerCase();
  return normalized.includes("thread not loaded");
}

export function isThreadNoRolloutIncludeTurnsAppServerRpcError(
  error: Error | null,
): boolean {
  if (!isInvalidRequestAppServerRpcError(error)) {
    return false;
  }
  if (!error) {
    return false;
  }
  const normalized = error.message.trim().toLowerCase();
  return (
    normalized.includes("no rollout found for thread id") &&
    normalized.includes("app-server error -32600")
  );
}

export function isIpcNoClientFoundError(error: Error | null): boolean {
  if (!(error instanceof DesktopIpcError)) {
    return false;
  }
  const normalized = error.message.trim().toLowerCase();
  return normalized.includes("no-client-found");
}

function normalizeStderrLine(line: string): string {
  return line.replace(ANSI_ESCAPE_REGEX, "").trim();
}

function isThreadStateGenerating(state: ThreadConversationState): boolean {
  for (let index = state.turns.length - 1; index >= 0; index -= 1) {
    const turn = state.turns[index];
    if (!turn) {
      continue;
    }

    const status = turn.status.trim().toLowerCase();
    const isTerminal =
      status === "completed" ||
      status === "failed" ||
      status === "error" ||
      status === "cancelled" ||
      status === "canceled" ||
      status === "interrupted" ||
      status === "aborted";
    if (isTerminal) {
      continue;
    }
    return true;
  }

  return false;
}

function deriveThreadWaitingState(
  state: ThreadConversationState,
): {
  waitingOnApproval: boolean;
  waitingOnUserInput: boolean;
} {
  let waitingOnApproval = false;
  let waitingOnUserInput = false;

  for (const request of state.requests) {
    if (request.completed === true) {
      continue;
    }

    switch (request.method) {
      case "item/tool/requestUserInput":
        waitingOnUserInput = true;
        break;
      case "item/commandExecution/requestApproval":
      case "item/fileChange/requestApproval":
      case "applyPatchApproval":
      case "execCommandApproval":
        waitingOnApproval = true;
        break;
      case "item/tool/call":
      case "account/chatgptAuthTokens/refresh":
      case "item/plan/requestImplementation":
        break;
    }
  }

  return {
    waitingOnApproval,
    waitingOnUserInput,
  };
}

function requestIdsMatch(
  left: UserInputRequestId,
  right: UserInputRequestId,
): boolean {
  return `${left}` === `${right}`;
}

function findPendingRequestWithId(
  state: ThreadConversationState,
  requestId: UserInputRequestId,
): ThreadConversationRequest | null {
  for (const request of state.requests) {
    if (request.completed === true) {
      continue;
    }
    if (requestIdsMatch(request.id, requestId)) {
      return request;
    }
  }
  return null;
}

function buildSyntheticSnapshotEvent(
  threadId: string,
  sourceClientId: string,
  conversationState: ThreadConversationState,
): ThreadStreamStateChangedBroadcast {
  return {
    type: "broadcast",
    method: "thread-stream-state-changed",
    sourceClientId,
    version: 0,
    params: {
      conversationId: threadId,
      change: {
        type: "snapshot",
        conversationState,
      },
      version: 0,
      type: "thread-stream-state-changed",
    },
  };
}

function trimThreadStreamEventsForReduction(
  events: ThreadStreamStateChangedBroadcast[],
): { events: ThreadStreamStateChangedBroadcast[]; hasSnapshot: boolean } {
  let latestSnapshotIndex = -1;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event?.params.change.type === "snapshot") {
      latestSnapshotIndex = index;
    }
  }

  if (latestSnapshotIndex === -1) {
    return {
      events,
      hasSnapshot: false,
    };
  }

  return {
    events: events.slice(latestSnapshotIndex),
    hasSnapshot: true,
  };
}

function extractThreadId(frame: IpcFrame): string | null {
  if (frame.type !== "request" && frame.type !== "broadcast") {
    return null;
  }

  const params = frame.params;
  if (!params || typeof params !== "object") {
    return null;
  }

  const asRecord = params as Record<string, string>;
  const candidates = [
    asRecord["conversationId"],
    asRecord["threadId"],
    asRecord["turnId"],
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return null;
}

async function readThreadIndexMetadata(
  threadId: string,
): Promise<ArchivedThreadIndexMetadata | null> {
  const codexHomes = getCodexHomeCandidates();
  for (const codexHome of codexHomes) {
    const indexPath = path.join(codexHome, "session_index.jsonl");
    try {
      const content = await readFile(indexPath, "utf8");
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }
        const parsed = JSON.parse(trimmed) as Record<string, unknown>;
        if (parsed["id"] !== threadId) {
          continue;
        }
        const parsedThreadName = parsed["thread_name"];
        const parsedUpdatedAt = parsed["updated_at"];
        return {
          title:
            typeof parsedThreadName === "string" ? parsedThreadName : null,
          updatedAt: parseTimestampToUnixSeconds(
            typeof parsedUpdatedAt === "string" ? parsedUpdatedAt : undefined,
          ),
        };
      }
    } catch {
      continue;
    }
  }

  return null;
}

async function findArchivedRolloutPath(threadId: string): Promise<string | null> {
  for (const codexHome of getCodexHomeCandidates()) {
    const archivedSessionsDir = path.join(codexHome, "archived_sessions");
    const archivedRollout = await findRolloutPathInDirectory(
      archivedSessionsDir,
      threadId,
      0,
    );
    if (archivedRollout) {
      return archivedRollout;
    }

    const sessionsDir = path.join(codexHome, "sessions");
    const activeRollout = await findRolloutPathInDirectory(sessionsDir, threadId, 4);
    if (activeRollout) {
      return activeRollout;
    }
  }

  return null;
}

async function findRolloutPathInDirectory(
  directory: string,
  threadId: string,
  remainingDepth: number,
): Promise<string | null> {
  try {
    await access(directory);
  } catch {
    return null;
  }

  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    if (!entry.name.endsWith(".jsonl") || !entry.name.includes(threadId)) {
      continue;
    }
    return path.join(directory, entry.name);
  }

  if (remainingDepth <= 0) {
    return null;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const nested = await findRolloutPathInDirectory(
      path.join(directory, entry.name),
      threadId,
      remainingDepth - 1,
    );
    if (nested) {
      return nested;
    }
  }

  return null;
}

function getCodexHomeCandidates(): string[] {
  const candidates = [
    process.env["CODEX_HOME"],
    process.env["USERPROFILE"]
      ? path.join(process.env["USERPROFILE"], ".codex")
      : null,
    process.env["HOME"] ? path.join(process.env["HOME"], ".codex") : null,
    path.join(os.homedir(), ".codex"),
  ];

  const unique = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate || candidate.trim().length === 0) {
      continue;
    }
    unique.add(candidate);
  }
  return [...unique];
}

function parseTimestampToUnixSeconds(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    return null;
  }
  return Math.floor(milliseconds / 1000);
}

import {
  AppServerClient,
  AppServerRpcError,
  AppServerTransportError,
  applyStrictPatch,
  DesktopIpcError,
  DesktopIpcClient,
  type SendRequestOptions,
} from "@farfield/api";
import {
  type AppServerServerNotification,
  type AppServerServerRequest,
  JsonValueSchema,
  LegacyReviewApprovalResponseSchema,
  ProtocolValidationError,
  CollaborationModeSchema,
  ContextCompactionItemSchema,
  ErrorItemSchema,
  ModelChangedItemSchema,
  parseThreadConversationState,
  parseThreadStreamStateChangedBroadcast,
  parseCommandExecutionRequestApprovalResponse,
  parseFileChangeRequestApprovalResponse,
  parseToolRequestUserInputResponsePayload,
  parseUserInputResponsePayload,
  TurnStartParamsSchema,
  type IpcFrame,
  type IpcRequestFrame,
  type IpcResponseFrame,
  ThreadStatusSchema,
  ThreadConversationRequestSchema,
  ThreadTurnSchema,
  TodoListItemSchema,
  TurnItemSchema,
  type TurnStartParams,
  type ThreadConversationRequest,
  type ThreadConversationState,
  type ThreadStreamStateChangedBroadcast,
  type UserInputResponsePayload,
  type UserInputRequestId,
} from "@farfield/protocol";
import { z } from "zod";
import { logger } from "../../logger.js";
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
  AgentTurnCollaborationMode,
} from "../types.js";

type StreamSnapshotOrigin = "stream" | "readThreadWithTurns" | "readThread";
type ThreadTurn = z.infer<typeof ThreadTurnSchema>;
type TurnItem = z.infer<typeof TurnItemSchema>;

type PendingAppServerRequestEntry = {
  request: ThreadConversationRequest;
  seenInAuthoritativeRead: boolean;
};

type PendingThreadRequestOwnerEntry = {
  requestId: UserInputRequestId;
  ownerClientId: string | null;
};

type ResolvedPendingThreadRequest = {
  request: ThreadConversationRequest;
  ownerClientId: string | null;
};

interface PendingThreadRefresh {
  sourceClientId: string | null;
  origin: StreamSnapshotOrigin;
  delayMs: number;
}

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

export interface CodexAppFrameEvent {
  direction: "in";
  kind: "notification" | "request";
  frame: AppServerServerNotification | AppServerServerRequest;
  method: string;
  threadId: string | null;
}

export interface CodexAppServerRequestEvent {
  threadId: string;
  request: ThreadConversationRequest;
}

export interface CodexAgentOptions {
  appExecutable: string;
  socketPath: string;
  workspaceDir: string;
  userAgent: string;
  reconnectDelayMs: number;
  onRuntimeStateChange?: () => void;
  onThreadStateChange?: (threadId: string) => void;
  onTiming?: (
    metricId:
      | "codexThreadList"
      | "codexThreadRead"
      | "codexThreadRefresh"
      | "codexLiveStateRead",
    durationMs: number,
  ) => void;
}

const ANSI_ESCAPE_REGEX = /\u001B\[[0-?]*[ -/]*[@-~]/g;
const APP_SERVER_THREAD_REFRESH_DEBOUNCE_MS = 120;
const IPC_THREAD_REFRESH_DEBOUNCE_MS = 1_500;
const THREAD_REFRESH_RETRY_DELAY_MS = 600;
const CONNECTION_CHECK_MIN_INTERVAL_MS = 2_000;

type ThreadActionRoute =
  | {
      kind: "desktop-owner";
      ownerClientId: string;
    }
  | {
      kind: "app-server";
    };

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

  private readonly appClient: AppServerClient;
  private readonly ipcClient: DesktopIpcClient;
  private readonly onRuntimeStateChange: (() => void) | null;
  private readonly onThreadStateChange: ((threadId: string) => void) | null;
  private readonly onTiming:
    | ((
        metricId:
          | "codexThreadList"
          | "codexThreadRead"
          | "codexThreadRefresh"
          | "codexLiveStateRead",
        durationMs: number,
      ) => void)
    | null;
  private readonly reconnectDelayMs: number;

  private readonly threadOwnerById = new Map<string, string>();
  private readonly desktopOwnedThreadIds = new Set<string>();
  private readonly pendingAppServerRequestsByThreadId = new Map<
    string,
    PendingAppServerRequestEntry[]
  >();
  private readonly pendingThreadRequestOwnersByThreadId = new Map<
    string,
    PendingThreadRequestOwnerEntry[]
  >();
  private readonly streamEventsByThreadId = new Map<string, IpcFrame[]>();
  private readonly activeTurnIdByThreadId = new Map<string, string>();
  private readonly pendingCollaborationModeByThreadId = new Map<
    string,
    AgentTurnCollaborationMode
  >();
  private readonly canonicalThreadStateById = new Map<
    string,
    ThreadConversationState
  >();
  private readonly canonicalThreadStateOriginById = new Map<
    string,
    StreamSnapshotOrigin
  >();
  private readonly streamPatchSyncDisabledThreadIds = new Set<string>();
  private readonly threadTitleById = new Map<string, string | null>();
  private readonly canonicalThreadStateErrorById = new Map<
    string,
    AgentThreadLiveState["liveStateError"]
  >();
  private readonly ipcFrameListeners = new Set<
    (event: CodexIpcFrameEvent) => void
  >();
  private readonly appFrameListeners = new Set<
    (event: CodexAppFrameEvent) => void
  >();
  private readonly appServerRequestListeners = new Set<
    (event: CodexAppServerRequestEvent) => void
  >();
  private readonly pendingThreadRefreshByThreadId = new Map<
    string,
    PendingThreadRefresh
  >();
  private readonly pendingThreadRefreshTimers = new Map<
    string,
    NodeJS.Timeout
  >();
  private readonly pendingOwnerBroadcastByThreadId = new Map<
    string,
    {
      thread: ThreadConversationState;
      ownerClientId: string | null;
    }
  >();
  private readonly pendingOwnerBroadcastTimers = new Map<string, NodeJS.Timeout>();
  private readonly threadRefreshesInFlight = new Set<string>();
  private ipcClientId: string | null = null;
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
  private lastConnectionCheckRequestedAtMs = 0;
  private started = false;

  public constructor(options: CodexAgentOptions) {
    this.onRuntimeStateChange = options.onRuntimeStateChange ?? null;
    this.onThreadStateChange = options.onThreadStateChange ?? null;
    this.onTiming = options.onTiming ?? null;
    this.reconnectDelayMs = options.reconnectDelayMs;

    this.appClient = new AppServerClient({
      executablePath: options.appExecutable,
      userAgent: options.userAgent,
      cwd: options.workspaceDir,
      experimentalApi: true,
      onStderr: (line) => {
        const normalized = normalizeStderrLine(line);
        logger.error({ line: normalized }, "codex-app-server-stderr");
      },
    });

    this.ipcClient = new DesktopIpcClient({
      socketPath: options.socketPath,
    });

    this.ipcClient.onConnectionState((state) => {
      if (!state.connected) {
        this.ipcClientId = null;
      }
      this.patchRuntimeState({
        ipcConnected: state.connected,
        ipcInitialized: state.connected
          ? this.runtimeState.ipcInitialized
          : false,
        ...(state.reason ? { lastError: state.reason } : {}),
      });

      if (!state.connected) {
        this.scheduleIpcReconnect();
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
      const isSelfOriginatedBroadcast =
        frame.type === "broadcast" &&
        sourceClientId.length > 0 &&
        this.ipcClientId !== null &&
        sourceClientId === this.ipcClientId;
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
        if (sourceClientId && !isSelfOriginatedBroadcast) {
          this.recordDesktopThreadOwner(threadId, sourceClientId);
        }
      }

      if (frame.type !== "broadcast") {
        return;
      }

      if (frame.method !== "thread-stream-state-changed" || !threadId) {
        return;
      }

      if (isSelfOriginatedBroadcast) {
        return;
      }

      const shouldRefresh = this.recordThreadStreamEvent(
        frame,
        threadId,
        sourceClientId || null,
      );
      if (shouldRefresh) {
        this.scheduleThreadRefresh(
          threadId,
          sourceClientId || null,
          "readThreadWithTurns",
          IPC_THREAD_REFRESH_DEBOUNCE_MS,
        );
      }
    });

    this.appClient.onServerNotification((notification) => {
      void this.handleServerNotification(notification);
    });
    this.appClient.onServerRequest((request) => {
      const threadId = this.capturePendingAppServerRequest(request);
      void this.handleServerRequest(request, threadId);
    });
  }

  public onIpcFrame(listener: (event: CodexIpcFrameEvent) => void): () => void {
    this.ipcFrameListeners.add(listener);
    return () => {
      this.ipcFrameListeners.delete(listener);
    };
  }

  public onAppFrame(listener: (event: CodexAppFrameEvent) => void): () => void {
    this.appFrameListeners.add(listener);
    return () => {
      this.appFrameListeners.delete(listener);
    };
  }

  public onAppServerRequest(
    listener: (event: CodexAppServerRequestEvent) => void,
  ): () => void {
    this.appServerRequestListeners.add(listener);
    return () => {
      this.appServerRequestListeners.delete(listener);
    };
  }

  public getRuntimeState(): CodexAgentRuntimeState {
    return { ...this.runtimeState };
  }

  public getThreadOwnerCount(): number {
    return this.threadOwnerById.size;
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

  public requestConnectionCheck(): void {
    if (!this.started || this.bootstrapInFlight) {
      return;
    }

    const nowMs = Date.now();
    if (
      nowMs - this.lastConnectionCheckRequestedAtMs <
      CONNECTION_CHECK_MIN_INTERVAL_MS
    ) {
      return;
    }

    this.lastConnectionCheckRequestedAtMs = nowMs;
    void this.bootstrapConnections();
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
    for (const timer of this.pendingThreadRefreshTimers.values()) {
      clearTimeout(timer);
    }
    for (const timer of this.pendingOwnerBroadcastTimers.values()) {
      clearTimeout(timer);
    }
    this.pendingThreadRefreshByThreadId.clear();
    this.pendingThreadRefreshTimers.clear();
    this.pendingOwnerBroadcastByThreadId.clear();
    this.pendingOwnerBroadcastTimers.clear();
    this.threadRefreshesInFlight.clear();

    await this.ipcClient.disconnect();
    await this.appClient.close();
  }

  public async listThreads(
    input: AgentListThreadsInput,
  ): Promise<AgentListThreadsResult> {
    this.ensureCodexAvailable();

    const startedAt = performance.now();
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
      const snapshot = this.canonicalThreadStateById.get(thread.id);
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

    const response = {
      data,
      nextCursor: result.nextCursor ?? null,
      ...(result.pages === undefined ? {} : { pages: result.pages }),
      ...(result.truncated === undefined
        ? {}
        : { truncated: result.truncated }),
    };
    this.onTiming?.("codexThreadList", performance.now() - startedAt);
    return response;
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
    const startedAt = performance.now();
    const canonicalThread = this.readCanonicalThreadState(input.threadId);
    if (canonicalThread && this.desktopOwnedThreadIds.has(input.threadId)) {
      this.onTiming?.("codexThreadRead", performance.now() - startedAt);
      return {
        thread: canonicalThread,
      };
    }

    const readThreadWithOption = async (includeTurns: boolean) => {
      return this.runAppServerCall(() =>
        this.appClient.readThread(input.threadId, includeTurns),
      );
    };

    let result: Awaited<ReturnType<typeof readThreadWithOption>>;
    try {
      result = await readThreadWithOption(input.includeTurns);
    } catch (error) {
      const typedError = error instanceof Error ? error : null;
      const shouldRetryWithoutTurns =
        input.includeTurns &&
        isEphemeralThreadIncludeTurnsAppServerRpcError(typedError);
      if (shouldRetryWithoutTurns) {
        result = await readThreadWithOption(false);
      } else {
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
          const resumeRetryErrorMessage = toErrorMessage(resumeRetryError);
          const shouldRetryWithoutTurns =
            input.includeTurns &&
            isIncludeTurnsUnsupportedAppServerRpcErrorMessage(
              resumeRetryErrorMessage,
            );
          if (!shouldRetryWithoutTurns) {
            throw resumeRetryError;
          }
          result = await readThreadWithOption(false);
        }
      }
    }
    const parsedThread = this.applyPendingCollaborationMode(
      this.mergePendingAppServerRequests(
        normalizeThreadConversationState(parseThreadConversationState(result.thread)),
        { authoritativeRead: true },
      ),
    );
    const existingSnapshot = this.canonicalThreadStateById.get(input.threadId);
    const shouldStoreSnapshot =
      input.includeTurns ||
      parsedThread.turns.length > 0 ||
      existingSnapshot === undefined;
    let returnedThread = parsedThread;
    if (shouldStoreSnapshot) {
      const snapshotOrigin: StreamSnapshotOrigin =
        input.includeTurns && parsedThread.turns.length > 0
          ? "readThreadWithTurns"
          : "readThread";
      returnedThread = this.storeCanonicalThreadState(
        input.threadId,
        parsedThread,
        snapshotOrigin,
        this.resolveVisibleOwnerClientId(input.threadId),
        false,
      );
    } else {
      returnedThread =
        this.readCanonicalThreadState(input.threadId) ?? parsedThread;
    }
    const response = {
      thread: returnedThread,
    };
    this.onTiming?.("codexThreadRead", performance.now() - startedAt);
    return response;
  }

  public async sendMessage(input: AgentSendMessageInput): Promise<void> {
    this.ensureCodexAvailable();
    const text = input.text.trim();
    if (text.length === 0) {
      throw new Error("Message text is required");
    }
    const route = this.resolveThreadActionRoute(
      input.threadId,
      input.ownerClientId,
    );

    const sendTurn = async (): Promise<void> => {
      if (input.isSteering === true) {
        if (route.kind === "desktop-owner") {
          try {
            await this.startTurnThroughOwnerClient(
              input.threadId,
              route.ownerClientId,
              {
                threadId: input.threadId,
                input: [{ type: "text", text }],
                ...(input.cwd ? { cwd: input.cwd } : {}),
                ...(input.model ? { model: input.model } : {}),
                ...(input.effort ? { effort: input.effort } : {}),
                ...(input.approvalPolicy
                  ? { approvalPolicy: input.approvalPolicy }
                  : {}),
                attachments: [],
              },
              true,
            );
            return;
          } catch (error) {
            if (!isIpcNoClientFoundMessage(toErrorMessage(error))) {
              throw error;
            }
            this.clearDisconnectedDesktopOwner(
              input.threadId,
              route.ownerClientId,
            );
          }
        }

        const activeTurnId = await this.getActiveTurnId(input.threadId);
        if (!activeTurnId) {
          throw new Error("Cannot steer because there is no active turn");
        }

        await this.appClient.steerTurn({
          threadId: input.threadId,
          expectedTurnId: activeTurnId,
          input: [{ type: "text", text }],
          ...(input.approvalPolicy
            ? { approvalPolicy: input.approvalPolicy }
            : {}),
        });
        return;
      }

      const pendingCollaborationMode =
        input.collaborationMode !== undefined
          ? input.collaborationMode
          : this.pendingCollaborationModeByThreadId.get(input.threadId);
      if (pendingCollaborationMode === null) {
        this.pendingCollaborationModeByThreadId.delete(input.threadId);
      } else if (pendingCollaborationMode !== undefined) {
        this.pendingCollaborationModeByThreadId.set(
          input.threadId,
          pendingCollaborationMode,
        );
      }
      const resolvedModel = await this.resolveTurnModelId(
        input.threadId,
        input.model,
        pendingCollaborationMode,
      );
      const turnStartParams = TurnStartParamsSchema.parse({
        threadId: input.threadId,
        input: [{ type: "text", text }],
        ...(input.cwd ? { cwd: input.cwd } : {}),
        model: resolvedModel,
        ...(input.effort ? { effort: input.effort } : {}),
        ...(pendingCollaborationMode !== undefined
          ? { collaborationMode: pendingCollaborationMode }
          : {}),
        ...(input.approvalPolicy
          ? { approvalPolicy: input.approvalPolicy }
          : {}),
        attachments: [],
      });
      if (route.kind === "desktop-owner") {
        try {
          await this.startTurnThroughOwnerClient(
            input.threadId,
            route.ownerClientId,
            turnStartParams,
            false,
          );
          return;
        } catch (error) {
          if (!isIpcNoClientFoundMessage(toErrorMessage(error))) {
            throw error;
          }
          this.clearDisconnectedDesktopOwner(
            input.threadId,
            route.ownerClientId,
          );
        }
      }
      await this.appClient.startTurn(turnStartParams);
    };
    await this.runThreadOperationWithResumeRetry(input.threadId, sendTurn);
    if (route.kind === "desktop-owner") {
      return;
    }
    this.scheduleThreadRefresh(
      input.threadId,
      null,
      "readThreadWithTurns",
      APP_SERVER_THREAD_REFRESH_DEBOUNCE_MS,
    );
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
    const route = this.resolveThreadActionRoute(
      input.threadId,
      input.ownerClientId,
    );

    if (route.kind === "desktop-owner") {
      this.syncModelAndReasoningThroughOwnerClient(
        input.threadId,
        route.ownerClientId,
        input.collaborationMode,
      );
      this.syncCollaborationModeThroughOwnerClient(
        input.threadId,
        route.ownerClientId,
        input.collaborationMode,
      );
    }

    this.pendingCollaborationModeByThreadId.set(
      input.threadId,
      input.collaborationMode,
    );

    const currentSnapshot = this.canonicalThreadStateById.get(input.threadId);
    if (currentSnapshot) {
      const nextSnapshot = this.applyPendingCollaborationMode(currentSnapshot);
      this.storeCanonicalThreadState(
        input.threadId,
        nextSnapshot,
        this.canonicalThreadStateOriginById.get(input.threadId) ?? "readThread",
        route.kind === "desktop-owner" ? route.ownerClientId : null,
        true,
      );
      this.broadcastThreadSnapshotToOwner(
        input.threadId,
        nextSnapshot,
        route.kind === "desktop-owner" ? route.ownerClientId : null,
      );
    }

    return {
      ownerClientId:
        route.kind === "desktop-owner" ? route.ownerClientId : "farfield",
    };
  }

  public async submitUserInput(
    input: AgentSubmitUserInputInput,
  ): Promise<{ ownerClientId: string; requestId: UserInputRequestId }> {
    this.ensureCodexAvailable();
    const parsedResponse = parseUserInputResponsePayload(input.response);
    const resolvedRequest = this.resolvePendingThreadRequestForSubmission(
      input.threadId,
      input.requestId,
      input.ownerClientId,
    );
    await this.submitResolvedPendingThreadRequest(
      input.threadId,
      input.requestId,
      resolvedRequest,
      parsedResponse,
    );

    const ownerClientIdForResult =
      resolvedRequest.ownerClientId ?? "app-server";
    this.removePendingAppServerRequest(input.threadId, input.requestId);
    this.removePendingThreadRequestOwner(input.threadId, input.requestId);
    this.notifyThreadStateChanged(input.threadId);
    this.scheduleThreadRefresh(
      input.threadId,
      ownerClientIdForResult,
      "readThreadWithTurns",
    );

    return {
      ownerClientId: ownerClientIdForResult,
      requestId: input.requestId,
    };
  }

  private resolvePendingThreadRequestForSubmission(
    threadId: string,
    requestId: UserInputRequestId,
    ownerClientIdOverride?: string,
  ): ResolvedPendingThreadRequest {
    const request = this.findPendingRequest(threadId, requestId);
    if (!request) {
      throw new Error(
        `Request ${String(requestId)} is not present in thread state for thread ${threadId}`,
      );
    }

    const recordedOwner = this.findPendingThreadRequestOwner(
      threadId,
      requestId,
    );
    if (recordedOwner) {
      return {
        request,
        ownerClientId: recordedOwner.ownerClientId,
      };
    }

    const ownerClientId =
      normalizeNonEmptyString(ownerClientIdOverride) ??
      normalizeNonEmptyString(this.threadOwnerById.get(threadId));

    return {
      request,
      ownerClientId,
    };
  }

  private async submitResolvedPendingThreadRequest(
    threadId: string,
    requestId: UserInputRequestId,
    resolvedRequest: ResolvedPendingThreadRequest,
    parsedResponse: UserInputResponsePayload,
  ): Promise<void> {
    const ownerClientId = resolvedRequest.ownerClientId;
    switch (resolvedRequest.request.method) {
      case "item/commandExecution/requestApproval": {
        await this.submitCommandApprovalResponse(
          threadId,
          requestId,
          ownerClientId,
          parsedResponse,
        );
        break;
      }

      case "item/fileChange/requestApproval": {
        await this.submitFileApprovalResponse(
          threadId,
          requestId,
          ownerClientId,
          parsedResponse,
        );
        break;
      }

      case "item/tool/requestUserInput": {
        await this.submitToolUserInputResponse(
          threadId,
          requestId,
          ownerClientId,
          parsedResponse,
        );
        break;
      }

      case "applyPatchApproval":
      case "execCommandApproval": {
        await this.submitLegacyApprovalResponse(requestId, parsedResponse);
        break;
      }

      case "item/tool/call":
      case "account/chatgptAuthTokens/refresh":
      case "item/plan/requestImplementation":
        throw new Error(
          `No submit responder registered for request method ${resolvedRequest.request.method}`,
        );
    }
  }

  private async submitCommandApprovalResponse(
    threadId: string,
    requestId: UserInputRequestId,
    ownerClientId: string | null,
    parsedResponse: UserInputResponsePayload,
  ): Promise<void> {
    const approvalResponse =
      parseCommandExecutionRequestApprovalResponse(parsedResponse);
    await this.ipcClient.sendRequestAndWait(
      "thread-follower-command-approval-decision",
      {
        conversationId: threadId,
        requestId,
        decision: approvalResponse.decision,
      },
      {
        ...(ownerClientId ? { targetClientId: ownerClientId } : {}),
        version: 1,
      },
    );
  }

  private async submitFileApprovalResponse(
    threadId: string,
    requestId: UserInputRequestId,
    ownerClientId: string | null,
    parsedResponse: UserInputResponsePayload,
  ): Promise<void> {
    const approvalResponse =
      parseFileChangeRequestApprovalResponse(parsedResponse);
    await this.ipcClient.sendRequestAndWait(
      "thread-follower-file-approval-decision",
      {
        conversationId: threadId,
        requestId,
        decision: approvalResponse.decision,
      },
      {
        ...(ownerClientId ? { targetClientId: ownerClientId } : {}),
        version: 1,
      },
    );
  }

  private async submitToolUserInputResponse(
    threadId: string,
    requestId: UserInputRequestId,
    ownerClientId: string | null,
    parsedResponse: UserInputResponsePayload,
  ): Promise<void> {
    const userInputResponse =
      parseToolRequestUserInputResponsePayload(parsedResponse);
    const ownerClientIdForResult = ownerClientId ?? "app-server";

    if (ownerClientIdForResult === "app-server") {
      await this.runAppServerCall(() =>
        this.appClient.submitUserInput(requestId, userInputResponse),
      );
      return;
    }

    await this.ipcClient.sendRequestAndWait(
      "thread-follower-submit-user-input",
      {
        conversationId: threadId,
        requestId,
        response: userInputResponse,
      },
      {
        targetClientId: ownerClientIdForResult,
        version: 1,
      },
    );
  }

  private async submitLegacyApprovalResponse(
    requestId: UserInputRequestId,
    parsedResponse: UserInputResponsePayload,
  ): Promise<void> {
    const approvalResponse =
      LegacyReviewApprovalResponseSchema.parse(parsedResponse);
    await this.runAppServerCall(() =>
      this.appClient.submitUserInput(requestId, approvalResponse),
    );
  }

  private findPendingRequest(
    threadId: string,
    requestId: UserInputRequestId,
  ): ThreadConversationRequest | null {
    const cachedEntries = this.pendingAppServerRequestsByThreadId.get(threadId);
    const cachedRequest = cachedEntries?.find((entry) =>
      requestIdsMatch(entry.request.id, requestId),
    )?.request;
    if (cachedRequest) {
      return cachedRequest;
    }

    const snapshotRequest = this.canonicalThreadStateById
      .get(threadId)
      ?.requests.find((request) => requestIdsMatch(request.id, requestId));
    return snapshotRequest ?? null;
  }

  public async readLiveState(threadId: string): Promise<AgentThreadLiveState> {
    const startedAt = performance.now();
    try {
      return {
        ownerClientId: this.threadOwnerById.get(threadId) ?? null,
        conversationState: this.readCanonicalThreadState(threadId),
        liveStateError: this.canonicalThreadStateErrorById.get(threadId) ?? null,
      };
    } finally {
      this.onTiming?.("codexLiveStateRead", performance.now() - startedAt);
    }
  }

  public async readStreamEvents(
    threadId: string,
    limit: number,
  ): Promise<AgentThreadStreamEvents> {
    return {
      ownerClientId: this.threadOwnerById.get(threadId) ?? null,
      events: (this.streamEventsByThreadId.get(threadId) ?? []).slice(-limit),
    };
  }

  private async startTurnThroughOwnerClient(
    threadId: string,
    ownerClientId: string,
    turnStartParams: TurnStartParams,
    isSteering: boolean,
  ): Promise<void> {
    await this.replayRequest(
      "thread-follower-start-turn",
      {
        conversationId: threadId,
        turnStartParams: TurnStartParamsSchema.parse(turnStartParams),
        isSteering,
      },
      {
        targetClientId: ownerClientId,
        version: 1,
      },
    );
  }

  private syncModelAndReasoningThroughOwnerClient(
    threadId: string,
    ownerClientId: string,
    collaborationMode: AgentTurnCollaborationMode,
  ): void {
    void this.replayRequest(
      "thread-follower-set-model-and-reasoning",
      {
        conversationId: threadId,
        model: collaborationMode.settings.model,
        reasoningEffort: collaborationMode.settings.reasoning_effort ?? null,
      },
      {
        targetClientId: ownerClientId,
        version: 1,
        timeoutMs: 5_000,
      },
    ).catch(() => {
      logger.warn(
        {
          threadId,
          ownerClientId,
        },
        "owner-model-reasoning-sync-failed",
      );
    });
  }

  private syncCollaborationModeThroughOwnerClient(
    threadId: string,
    ownerClientId: string,
    collaborationMode: AgentTurnCollaborationMode,
  ): void {
    const parsedCollaborationMode =
      CollaborationModeSchema.parse(collaborationMode);
    void this.replayRequest(
      "thread-follower-set-collaboration-mode",
      {
        conversationId: threadId,
        collaborationMode: parsedCollaborationMode,
      },
      {
        targetClientId: ownerClientId,
        version: 1,
        timeoutMs: 5_000,
      },
    ).catch(() => {
      logger.warn(
        {
          threadId,
          ownerClientId,
        },
        "owner-collaboration-mode-sync-failed",
      );
    });
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

  private emitAppFrame(event: CodexAppFrameEvent): void {
    for (const listener of this.appFrameListeners) {
      listener(event);
    }
  }

  private emitAppServerRequest(event: CodexAppServerRequestEvent): void {
    for (const listener of this.appServerRequestListeners) {
      listener(event);
    }
  }

  private capturePendingAppServerRequest(
    request: AppServerServerRequest,
  ): string | null {
    const parsedRequest = ThreadConversationRequestSchema.safeParse(request);
    if (!parsedRequest.success) {
      logger.error(
        {
          method: request.method,
          issues: parsedRequest.error.issues,
        },
        "codex-app-server-request-parse-failed",
      );
      return null;
    }

    const threadId = extractThreadIdFromConversationRequest(parsedRequest.data);
    if (!threadId) {
      return null;
    }

    this.upsertPendingAppServerRequest(threadId, parsedRequest.data);
    if (parsedRequest.data.completed === true) {
      this.removePendingThreadRequestOwner(threadId, parsedRequest.data.id);
    } else {
      this.upsertPendingThreadRequestOwner(
        threadId,
        parsedRequest.data.id,
        null,
        true,
      );
    }
    this.notifyThreadStateChanged(threadId);
    this.emitAppServerRequest({
      threadId,
      request: parsedRequest.data,
    });
    return threadId;
  }

  private upsertPendingAppServerRequest(
    threadId: string,
    request: ThreadConversationRequest,
  ): void {
    const current = this.pendingAppServerRequestsByThreadId.get(threadId) ?? [];
    const next = current.filter(
      (entry) => !requestIdsMatch(entry.request.id, request.id),
    );
    if (request.completed === true) {
      if (next.length === 0) {
        this.pendingAppServerRequestsByThreadId.delete(threadId);
        return;
      }
      this.pendingAppServerRequestsByThreadId.set(threadId, next);
      return;
    }
    next.push({
      request,
      seenInAuthoritativeRead: false,
    });
    this.pendingAppServerRequestsByThreadId.set(threadId, next);
  }

  private removePendingAppServerRequest(
    threadId: string,
    requestId: UserInputRequestId,
  ): void {
    const current = this.pendingAppServerRequestsByThreadId.get(threadId);
    if (!current) {
      return;
    }

    const next = current.filter((entry) =>
      !requestIdsMatch(entry.request.id, requestId),
    );
    if (next.length === 0) {
      this.pendingAppServerRequestsByThreadId.delete(threadId);
      return;
    }

    this.pendingAppServerRequestsByThreadId.set(threadId, next);
  }

  private findPendingThreadRequestOwner(
    threadId: string,
    requestId: UserInputRequestId,
  ): PendingThreadRequestOwnerEntry | null {
    const owners = this.pendingThreadRequestOwnersByThreadId.get(threadId);
    return (
      owners?.find((entry) => requestIdsMatch(entry.requestId, requestId)) ??
      null
    );
  }

  private upsertPendingThreadRequestOwner(
    threadId: string,
    requestId: UserInputRequestId,
    ownerClientId: string | null,
    replaceExisting: boolean,
  ): void {
    const current =
      this.pendingThreadRequestOwnersByThreadId.get(threadId) ?? [];
    const existing = current.find((entry) =>
      requestIdsMatch(entry.requestId, requestId),
    );
    if (existing && !replaceExisting) {
      return;
    }

    const next = current.filter(
      (entry) => !requestIdsMatch(entry.requestId, requestId),
    );
    next.push({
      requestId,
      ownerClientId,
    });
    this.pendingThreadRequestOwnersByThreadId.set(threadId, next);
  }

  private removePendingThreadRequestOwner(
    threadId: string,
    requestId: UserInputRequestId,
  ): void {
    const current = this.pendingThreadRequestOwnersByThreadId.get(threadId);
    if (!current) {
      return;
    }

    const next = current.filter((entry) =>
      !requestIdsMatch(entry.requestId, requestId),
    );
    if (next.length === 0) {
      this.pendingThreadRequestOwnersByThreadId.delete(threadId);
      return;
    }

    this.pendingThreadRequestOwnersByThreadId.set(threadId, next);
  }

  private syncPendingThreadRequestOwners(
    threadId: string,
    state: ThreadConversationState,
    ownerClientId: string | null,
    replaceExisting: boolean,
  ): void {
    if (replaceExisting) {
      const current =
        this.pendingThreadRequestOwnersByThreadId.get(threadId) ?? [];
      const next = current.filter((entry) =>
        state.requests.find((request) =>
          requestIdsMatch(request.id, entry.requestId),
        ),
      );
      if (next.length === 0) {
        this.pendingThreadRequestOwnersByThreadId.delete(threadId);
      } else {
        this.pendingThreadRequestOwnersByThreadId.set(threadId, next);
      }
    }

    for (const request of state.requests) {
      if (request.completed === true) {
        this.removePendingThreadRequestOwner(threadId, request.id);
        continue;
      }
      this.upsertPendingThreadRequestOwner(
        threadId,
        request.id,
        ownerClientId,
        replaceExisting,
      );
    }
  }

  private mergePendingAppServerRequests(
    state: ThreadConversationState,
    options: { authoritativeRead: boolean } = { authoritativeRead: false },
  ): ThreadConversationState {
    const cachedEntries = this.pendingAppServerRequestsByThreadId.get(state.id);
    if (!cachedEntries || cachedEntries.length === 0) {
      return state;
    }

    const mergedRequests = [...state.requests];
    const nextCachedEntries: PendingAppServerRequestEntry[] = [];
    for (const cachedEntry of cachedEntries) {
      const authoritativeRequest = state.requests.find((request) =>
        requestIdsMatch(request.id, cachedEntry.request.id),
      );

      if (authoritativeRequest) {
        if (authoritativeRequest.completed !== true) {
          nextCachedEntries.push({
            request: authoritativeRequest,
            seenInAuthoritativeRead:
              cachedEntry.seenInAuthoritativeRead ||
              options.authoritativeRead,
          });
        }
        continue;
      }

      if (options.authoritativeRead && cachedEntry.seenInAuthoritativeRead) {
        continue;
      }

      nextCachedEntries.push(cachedEntry);
      mergedRequests.push(cachedEntry.request);
    }

    if (nextCachedEntries.length === 0) {
      this.pendingAppServerRequestsByThreadId.delete(state.id);
    } else {
      this.pendingAppServerRequestsByThreadId.set(state.id, nextCachedEntries);
    }

    return {
      ...state,
      requests: mergedRequests,
    };
  }

  private readCanonicalThreadState(
    threadId: string,
  ): ThreadConversationState | null {
    const snapshot = this.canonicalThreadStateById.get(threadId);
    if (!snapshot) {
      return null;
    }
    return this.mergePendingAppServerRequests(snapshot);
  }

  private async handleServerNotification(
    notification: AppServerServerNotification,
  ): Promise<void> {
    const threadId = extractThreadIdFromAppServerNotification(notification);
    this.updateActiveTurnFromAppServerNotification(notification);
    if (threadId && !this.applyAppServerNotificationToSnapshot(notification)) {
      this.scheduleThreadRefresh(
        threadId,
        this.resolveVisibleOwnerClientId(threadId),
        "readThreadWithTurns",
        APP_SERVER_THREAD_REFRESH_DEBOUNCE_MS,
      );
    }
    this.emitAppFrame({
      direction: "in",
      kind: "notification",
      frame: notification,
      method: notification.method,
      threadId,
    });
  }

  private async handleServerRequest(
    request: AppServerServerRequest,
    threadId: string | null,
  ): Promise<void> {
    if (!threadId) {
      return;
    }
    await this.refreshThreadFromAppServer(
      threadId,
      this.resolveVisibleOwnerClientId(threadId),
      "readThreadWithTurns",
    );
    this.emitAppFrame({
      direction: "in",
      kind: "request",
      frame: request,
      method: request.method,
      threadId,
    });
  }

  private scheduleThreadRefresh(
    threadId: string,
    sourceClientId: string | null,
    origin: StreamSnapshotOrigin,
    delayMs = APP_SERVER_THREAD_REFRESH_DEBOUNCE_MS,
  ): void {
    if (sourceClientId) {
      this.threadOwnerById.set(threadId, sourceClientId);
    }

    const existingRefresh = this.pendingThreadRefreshByThreadId.get(threadId);
    this.pendingThreadRefreshByThreadId.set(threadId, {
      sourceClientId:
        sourceClientId ??
        existingRefresh?.sourceClientId ??
        this.resolveVisibleOwnerClientId(threadId),
      origin,
      delayMs: existingRefresh?.delayMs ?? delayMs,
    });

    if (
      this.pendingThreadRefreshTimers.has(threadId) ||
      this.threadRefreshesInFlight.has(threadId)
    ) {
      return;
    }

    this.queueThreadRefreshTimer(threadId, delayMs);
  }

  private queueThreadRefreshTimer(threadId: string, delayMs: number): void {
    if (this.pendingThreadRefreshTimers.has(threadId)) {
      return;
    }

    const timer = setTimeout(() => {
      this.pendingThreadRefreshTimers.delete(threadId);
      void this.performScheduledThreadRefresh(threadId);
    }, delayMs);
    timer.unref();
    this.pendingThreadRefreshTimers.set(threadId, timer);
  }

  private async performScheduledThreadRefresh(threadId: string): Promise<void> {
    const pendingRefresh = this.pendingThreadRefreshByThreadId.get(threadId);
    if (!pendingRefresh) {
      return;
    }

    if (this.threadRefreshesInFlight.has(threadId)) {
      this.queueThreadRefreshTimer(threadId, pendingRefresh.delayMs);
      return;
    }

    this.pendingThreadRefreshByThreadId.delete(threadId);
    this.threadRefreshesInFlight.add(threadId);

    try {
      await this.refreshThreadFromAppServer(
        threadId,
        pendingRefresh.sourceClientId,
        pendingRefresh.origin,
      );
    } finally {
      this.threadRefreshesInFlight.delete(threadId);
      const nextRefresh = this.pendingThreadRefreshByThreadId.get(threadId);
      if (nextRefresh) {
        this.queueThreadRefreshTimer(threadId, nextRefresh.delayMs);
      }
    }
  }

  private async refreshThreadFromAppServer(
    threadId: string,
    sourceClientId: string | null,
    origin: StreamSnapshotOrigin,
  ): Promise<void> {
    const startedAt = performance.now();
    try {
      const readResult = await this.readThread({
        threadId,
        includeTurns: true,
      });
      const storedThread = this.storeCanonicalThreadState(
        threadId,
        readResult.thread,
        origin,
        sourceClientId,
        true,
      );
      this.scheduleThreadSnapshotBroadcastToOwner(
        threadId,
        storedThread,
        sourceClientId,
      );
    } catch (error) {
      if (error instanceof AppServerRpcError && error.code === -32001) {
        this.scheduleThreadRefresh(
          threadId,
          sourceClientId,
          origin,
          THREAD_REFRESH_RETRY_DELAY_MS,
        );
        return;
      }

      logger.warn(
        {
          threadId,
          error: toErrorMessage(error),
          ...(error instanceof ProtocolValidationError
            ? { issues: error.issues }
            : {}),
        },
        "app-server-thread-refresh-failed",
      );
    } finally {
      this.onTiming?.("codexThreadRefresh", performance.now() - startedAt);
    }
  }

  private storeCanonicalThreadState(
    threadId: string,
    thread: ThreadConversationState,
    origin: StreamSnapshotOrigin,
    sourceClientId: string | null,
    appendSyntheticSnapshotEvent: boolean,
  ): ThreadConversationState {
    const currentSnapshot = this.canonicalThreadStateById.get(threadId);
    const currentOrigin = this.canonicalThreadStateOriginById.get(threadId);
    const shouldMergeReadSnapshot =
      currentSnapshot !== undefined &&
      currentOrigin === "stream" &&
      origin !== "stream";
    const nextOrigin =
      shouldMergeReadSnapshot && currentOrigin ? currentOrigin : origin;
    const mergedThread = shouldMergeReadSnapshot
      ? mergeThreadConversationStates(currentSnapshot, thread)
      : thread;
    const nextThread = this.applyPendingCollaborationMode(mergedThread);
    this.canonicalThreadStateById.set(threadId, nextThread);
    this.canonicalThreadStateOriginById.set(threadId, nextOrigin);
    this.canonicalThreadStateErrorById.delete(threadId);
    this.setThreadTitle(threadId, nextThread.title);
    this.syncActiveTurnIdFromThreadState(threadId, nextThread);
    this.syncPendingThreadRequestOwners(
      threadId,
      nextThread,
      sourceClientId,
      origin === "stream",
    );

    if (!appendSyntheticSnapshotEvent) {
      return nextThread;
    }

    const nextSourceClientId = sourceClientId ?? "app-server";
    const currentEvents = this.streamEventsByThreadId.get(threadId) ?? [];
    currentEvents.push(
      buildSyntheticSnapshotEvent(threadId, nextSourceClientId, nextThread),
    );
    if (currentEvents.length > 400) {
      currentEvents.splice(0, currentEvents.length - 400);
    }
    this.streamEventsByThreadId.set(threadId, currentEvents);
    this.notifyThreadStateChanged(threadId);
    return nextThread;
  }

  private recordThreadStreamEvent(
    frame: IpcFrame,
    threadId: string,
    sourceClientId: string | null,
  ): boolean {
    let parsedFrame: ThreadStreamStateChangedBroadcast;
    try {
      parsedFrame = parseThreadStreamStateChangedBroadcast(frame);
    } catch (error) {
      logger.error(
        {
          threadId,
          error: toErrorMessage(error),
          ...(error instanceof ProtocolValidationError
            ? { issues: error.issues }
            : {}),
        },
        "thread-stream-event-parse-failed",
      );
      this.canonicalThreadStateErrorById.set(threadId, {
        kind: "parseFailed",
        message: toErrorMessage(error),
        eventIndex: null,
        patchIndex: null,
      });
      return false;
    }

    const currentEvents = this.streamEventsByThreadId.get(threadId) ?? [];
    currentEvents.push(parsedFrame);
    if (currentEvents.length > 400) {
      currentEvents.splice(0, currentEvents.length - 400);
    }
    this.streamEventsByThreadId.set(threadId, currentEvents);

    if (parsedFrame.params.change.type === "snapshot") {
      this.streamPatchSyncDisabledThreadIds.delete(threadId);
      this.storeCanonicalThreadState(
        threadId,
        parsedFrame.params.change.conversationState,
        "stream",
        sourceClientId,
        false,
      );
      this.notifyThreadStateChanged(threadId);
      return false;
    }

    if (this.streamPatchSyncDisabledThreadIds.has(threadId)) {
      this.notifyThreadStateChanged(threadId);
      return false;
    }

    const currentSnapshot = this.canonicalThreadStateById.get(threadId);
    if (!currentSnapshot) {
      this.streamPatchSyncDisabledThreadIds.add(threadId);
      this.canonicalThreadStateErrorById.set(threadId, {
        kind: "reductionFailed",
        message: "Thread stream patches arrived before any thread snapshot",
        eventIndex: null,
        patchIndex: null,
      });
      this.notifyThreadStateChanged(threadId);
      return true;
    }

    try {
      let nextSnapshot = currentSnapshot;
      for (let patchIndex = 0; patchIndex < parsedFrame.params.change.patches.length; patchIndex += 1) {
        const patch = parsedFrame.params.change.patches[patchIndex];
        if (!patch) {
          continue;
        }
        nextSnapshot = applyStrictPatch(nextSnapshot, patch);
      }
      this.storeCanonicalThreadState(
        threadId,
        nextSnapshot,
        "stream",
        sourceClientId,
        false,
      );
    } catch (error) {
      logger.warn(
        {
          threadId,
          error: toErrorMessage(error),
        },
        "thread-stream-patch-apply-failed",
      );
      this.streamPatchSyncDisabledThreadIds.add(threadId);
      this.canonicalThreadStateErrorById.set(threadId, {
        kind: "reductionFailed",
        message: toErrorMessage(error),
        eventIndex: null,
        patchIndex: null,
      });
      this.notifyThreadStateChanged(threadId);
      return true;
    }

    this.notifyThreadStateChanged(threadId);
    return false;
  }

  private applyAppServerNotificationToSnapshot(
    notification: AppServerServerNotification,
  ): boolean {
    const threadId = extractThreadIdFromAppServerNotification(notification);
    if (!threadId) {
      return false;
    }

    const currentSnapshot = this.canonicalThreadStateById.get(threadId) ?? null;
    const currentSnapshotOrigin =
      this.canonicalThreadStateOriginById.get(threadId) ?? "readThread";
    const ownerClientId = this.resolveVisibleOwnerClientId(threadId);

    if (notification.method === "thread/started") {
      const parsedThreadStarted =
        AppServerThreadStartedStateNotificationSchema.safeParse(notification);
      if (!parsedThreadStarted.success) {
        return false;
      }

      const nextThread = parseThreadConversationState(
        parsedThreadStarted.data.params.thread,
      );
      const storedThread = this.storeCanonicalThreadState(
        threadId,
        nextThread,
        currentSnapshotOrigin,
        ownerClientId,
        false,
      );
      this.scheduleThreadSnapshotBroadcastToOwner(
        threadId,
        storedThread,
        ownerClientId,
      );
      this.notifyThreadStateChanged(threadId);
      return true;
    }

    if (!currentSnapshot) {
      return false;
    }

    const nextThread = (() => {
      switch (notification.method) {
        case "thread/status/changed": {
          const parsedStatusChanged =
            AppServerThreadStatusChangedNotificationSchema.safeParse(
              notification,
            );
          if (!parsedStatusChanged.success) {
            return null;
          }
          return {
            ...currentSnapshot,
            status: parsedStatusChanged.data.params.status,
          };
        }
        case "thread/name/updated": {
          const parsedNameUpdated =
            AppServerThreadNameUpdatedNotificationSchema.safeParse(notification);
          if (!parsedNameUpdated.success) {
            return null;
          }
          return {
            ...currentSnapshot,
            title: parsedNameUpdated.data.params.threadName ?? null,
          };
        }
        case "thread/archived":
        case "thread/unarchived":
        case "thread/closed":
        case "thread/realtime/started":
        case "thread/realtime/itemAdded":
        case "thread/realtime/outputAudio/delta":
        case "thread/realtime/error":
        case "thread/realtime/closed":
        case "windows/worldWritableWarning":
        case "windowsSandbox/setupCompleted":
          return currentSnapshot;
        case "turn/started":
        case "turn/completed": {
          const parsedTurnNotification =
            AppServerTurnThreadNotificationSchema.safeParse(notification);
          if (!parsedTurnNotification.success) {
            return null;
          }
          return upsertTurnIntoThread(
            currentSnapshot,
            parsedTurnNotification.data.params.turn,
          );
        }
        case "turn/diff/updated": {
          const parsedDiffUpdated =
            AppServerTurnDiffUpdatedNotificationSchema.safeParse(notification);
          if (!parsedDiffUpdated.success) {
            return null;
          }
          return updateThreadTurn(
            currentSnapshot,
            parsedDiffUpdated.data.params.turnId,
            (turn) => ({
              ...turn,
              diff: parsedDiffUpdated.data.params.diff,
            }),
          );
        }
        case "turn/plan/updated": {
          const parsedPlanUpdated =
            AppServerTurnPlanUpdatedNotificationSchema.safeParse(notification);
          if (!parsedPlanUpdated.success) {
            return null;
          }
          return upsertTurnItem(
            currentSnapshot,
            parsedPlanUpdated.data.params.turnId,
            TodoListItemSchema.parse({
              id: buildSyntheticTurnItemId(
                "turn-plan",
                parsedPlanUpdated.data.params.turnId,
              ),
              type: "todo-list",
              explanation: parsedPlanUpdated.data.params.explanation,
              plan: parsedPlanUpdated.data.params.plan,
            }),
          );
        }
        case "item/started":
        case "item/completed": {
          const parsedItemNotification =
            AppServerItemThreadNotificationSchema.safeParse(notification);
          if (!parsedItemNotification.success) {
            return null;
          }
          return upsertTurnItem(
            currentSnapshot,
            parsedItemNotification.data.params.turnId,
            parsedItemNotification.data.params.item,
          );
        }
        case "item/agentMessage/delta": {
          const parsedAgentMessageDelta =
            AppServerAgentMessageDeltaNotificationSchema.safeParse(notification);
          if (!parsedAgentMessageDelta.success) {
            return null;
          }
          return updateThreadItem(
            currentSnapshot,
            parsedAgentMessageDelta.data.params.turnId,
            parsedAgentMessageDelta.data.params.itemId,
            (item) => {
              if (item.type !== "agentMessage") {
                return item;
              }
              return {
                ...item,
                text: `${item.text}${parsedAgentMessageDelta.data.params.delta}`,
              };
            },
          );
        }
        case "item/reasoning/textDelta": {
          const parsedReasoningDelta =
            AppServerReasoningTextDeltaNotificationSchema.safeParse(notification);
          if (!parsedReasoningDelta.success) {
            return null;
          }
          return updateThreadItem(
            currentSnapshot,
            parsedReasoningDelta.data.params.turnId,
            parsedReasoningDelta.data.params.itemId,
            (item) => {
              if (item.type !== "reasoning") {
                return item;
              }
              const content = [...(item.content ?? [])];
              const index = parsedReasoningDelta.data.params.contentIndex;
              const currentValue = content[index];
              const currentText =
                typeof currentValue === "string" ? currentValue : "";
              content[index] = `${currentText}${parsedReasoningDelta.data.params.delta}`;
              return {
                ...item,
                content,
                text: `${item.text ?? ""}${parsedReasoningDelta.data.params.delta}`,
              };
            },
          );
        }
        case "item/reasoning/summaryPartAdded": {
          const parsedSummaryPart =
            AppServerReasoningSummaryPartAddedNotificationSchema.safeParse(
              notification,
            );
          if (!parsedSummaryPart.success) {
            return null;
          }
          return updateThreadItem(
            currentSnapshot,
            parsedSummaryPart.data.params.turnId,
            parsedSummaryPart.data.params.itemId,
            (item) => {
              if (item.type !== "reasoning") {
                return item;
              }
              const summary = [...(item.summary ?? [])];
              const index = parsedSummaryPart.data.params.summaryIndex;
              while (summary.length <= index) {
                summary.push("");
              }
              return {
                ...item,
                summary,
              };
            },
          );
        }
        case "item/reasoning/summaryTextDelta": {
          const parsedSummaryDelta =
            AppServerReasoningSummaryTextDeltaNotificationSchema.safeParse(
              notification,
            );
          if (!parsedSummaryDelta.success) {
            return null;
          }
          return updateThreadItem(
            currentSnapshot,
            parsedSummaryDelta.data.params.turnId,
            parsedSummaryDelta.data.params.itemId,
            (item) => {
              if (item.type !== "reasoning") {
                return item;
              }
              const summary = [...(item.summary ?? [])];
              const index = parsedSummaryDelta.data.params.summaryIndex;
              while (summary.length <= index) {
                summary.push("");
              }
              summary[index] = `${summary[index] ?? ""}${parsedSummaryDelta.data.params.delta}`;
              return {
                ...item,
                summary,
              };
            },
          );
        }
        case "item/plan/delta": {
          const parsedPlanDelta =
            AppServerPlanDeltaNotificationSchema.safeParse(notification);
          if (!parsedPlanDelta.success) {
            return null;
          }
          return updateThreadItem(
            currentSnapshot,
            parsedPlanDelta.data.params.turnId,
            parsedPlanDelta.data.params.itemId,
            (item) => {
              if (item.type !== "plan") {
                return item;
              }
              return {
                ...item,
                text: `${item.text}${parsedPlanDelta.data.params.delta}`,
              };
            },
          );
        }
        case "item/commandExecution/outputDelta": {
          const parsedCommandDelta =
            AppServerCommandOutputDeltaNotificationSchema.safeParse(notification);
          if (!parsedCommandDelta.success) {
            return null;
          }
          return updateThreadItem(
            currentSnapshot,
            parsedCommandDelta.data.params.turnId,
            parsedCommandDelta.data.params.itemId,
            (item) => {
              if (item.type !== "commandExecution") {
                return item;
              }
              return {
                ...item,
                aggregatedOutput: `${item.aggregatedOutput ?? ""}${parsedCommandDelta.data.params.delta}`,
              };
            },
          );
        }
        case "item/commandExecution/terminalInteraction": {
          const parsedTerminalInteraction =
            AppServerTerminalInteractionNotificationSchema.safeParse(
              notification,
            );
          if (!parsedTerminalInteraction.success) {
            return null;
          }
          return currentSnapshot;
        }
        case "item/fileChange/outputDelta": {
          const parsedFileChangeDelta =
            AppServerFileChangeOutputDeltaNotificationSchema.safeParse(
              notification,
            );
          if (!parsedFileChangeDelta.success) {
            return null;
          }
          return updateThreadItem(
            currentSnapshot,
            parsedFileChangeDelta.data.params.turnId,
            parsedFileChangeDelta.data.params.itemId,
            (item) => {
              if (item.type !== "fileChange") {
                return item;
              }
              if (item.changes.length === 0) {
                return item;
              }
              const nextChanges = [...item.changes];
              const lastChange = nextChanges[nextChanges.length - 1];
              if (!lastChange) {
                return item;
              }
              nextChanges[nextChanges.length - 1] = {
                ...lastChange,
                diff: `${lastChange.diff ?? ""}${parsedFileChangeDelta.data.params.delta}`,
              };
              return {
                ...item,
                changes: nextChanges,
              };
            },
          );
        }
        case "item/mcpToolCall/progress": {
          const parsedMcpProgress =
            AppServerMcpToolCallProgressNotificationSchema.safeParse(
              notification,
            );
          if (!parsedMcpProgress.success) {
            return null;
          }
          return currentSnapshot;
        }
        case "thread/tokenUsage/updated": {
          const parsedTokenUsage =
            AppServerThreadTokenUsageUpdatedNotificationSchema.safeParse(
              notification,
            );
          if (!parsedTokenUsage.success) {
            return null;
          }
          return {
            ...currentSnapshot,
            latestTokenUsageInfo: parsedTokenUsage.data.params.tokenUsage,
          };
        }
        case "thread/compacted": {
          const parsedCompacted =
            AppServerThreadCompactedNotificationSchema.safeParse(notification);
          if (!parsedCompacted.success) {
            return null;
          }
          return upsertTurnItem(
            currentSnapshot,
            parsedCompacted.data.params.turnId,
            ContextCompactionItemSchema.parse({
              id: buildSyntheticTurnItemId(
                "context-compaction",
                parsedCompacted.data.params.turnId,
              ),
              type: "contextCompaction",
            }),
          );
        }
        case "model/rerouted": {
          const parsedModelRerouted =
            AppServerModelReroutedNotificationSchema.safeParse(notification);
          if (!parsedModelRerouted.success) {
            return null;
          }
          return upsertTurnItem(
            {
              ...currentSnapshot,
              latestModel: parsedModelRerouted.data.params.toModel,
            },
            parsedModelRerouted.data.params.turnId,
            ModelChangedItemSchema.parse({
              id: buildSyntheticTurnItemId(
                "model-rerouted",
                parsedModelRerouted.data.params.turnId,
              ),
              type: "modelChanged",
              fromModel: parsedModelRerouted.data.params.fromModel,
              toModel: parsedModelRerouted.data.params.toModel,
            }),
          );
        }
        case "error": {
          const parsedErrorNotification =
            AppServerErrorNotificationSchema.safeParse(notification);
          if (!parsedErrorNotification.success) {
            return null;
          }
          return upsertTurnItem(
            currentSnapshot,
            parsedErrorNotification.data.params.turnId,
            ErrorItemSchema.parse({
              id: buildSyntheticTurnItemId(
                "turn-error",
                parsedErrorNotification.data.params.turnId,
              ),
              type: "error",
              message: parsedErrorNotification.data.params.error.message,
              willRetry: parsedErrorNotification.data.params.willRetry,
              errorInfo:
                parsedErrorNotification.data.params.error.codexErrorInfo ===
                null
                  ? null
                  : JSON.stringify(
                      parsedErrorNotification.data.params.error.codexErrorInfo,
                    ),
              additionalDetails:
                parsedErrorNotification.data.params.error.additionalDetails,
            }),
          );
        }
        default:
          return null;
      }
    })();

    if (!nextThread) {
      return false;
    }

    if (nextThread === currentSnapshot) {
      return true;
    }

    const storedThread = this.storeCanonicalThreadState(
      threadId,
      nextThread,
      currentSnapshotOrigin,
      ownerClientId,
      false,
    );
    if (shouldBroadcastThreadSnapshotForAppServerNotification(notification.method)) {
      this.scheduleThreadSnapshotBroadcastToOwner(
        threadId,
        storedThread,
        ownerClientId,
      );
    }
    this.notifyThreadStateChanged(threadId);
    return true;
  }

  private scheduleThreadSnapshotBroadcastToOwner(
    threadId: string,
    thread: ThreadConversationState,
    ownerClientId: string | null,
    delayMs = 80,
  ): void {
    this.pendingOwnerBroadcastByThreadId.set(threadId, {
      thread,
      ownerClientId,
    });

    if (this.pendingOwnerBroadcastTimers.has(threadId)) {
      return;
    }

    const timer = setTimeout(() => {
      this.pendingOwnerBroadcastTimers.delete(threadId);
      const pending = this.pendingOwnerBroadcastByThreadId.get(threadId);
      if (!pending) {
        return;
      }
      this.pendingOwnerBroadcastByThreadId.delete(threadId);
      this.broadcastThreadSnapshotToOwner(
        threadId,
        pending.thread,
        pending.ownerClientId,
      );
    }, delayMs);
    timer.unref();
    this.pendingOwnerBroadcastTimers.set(threadId, timer);
  }

  private broadcastThreadSnapshotToOwner(
    threadId: string,
    thread: ThreadConversationState,
    ownerClientId: string | null,
  ): void {
    const targetClientId = normalizeNonEmptyString(ownerClientId);
    if (!targetClientId || !this.isIpcReady()) {
      return;
    }

    if (this.ipcClientId && targetClientId === this.ipcClientId) {
      return;
    }

    try {
      const event = buildSyntheticSnapshotEvent(threadId, "farfield", thread);
      this.replayBroadcast("thread-stream-state-changed", event.params, {
        targetClientId,
        version: event.version,
      });
    } catch (error) {
      logger.warn(
        {
          threadId,
          targetClientId,
          error: toErrorMessage(error),
        },
        "desktop-thread-sync-broadcast-failed",
      );
    }
  }

  private async resolveTurnModelId(
    threadId: string,
    requestedModel: string | undefined,
    pendingCollaborationMode: AgentTurnCollaborationMode | null | undefined,
  ): Promise<string> {
    const explicitModel = normalizeNonEmptyString(requestedModel);
    if (explicitModel) {
      return explicitModel;
    }

    const pendingModeModel = normalizeNonEmptyString(
      pendingCollaborationMode?.settings.model,
    );
    if (pendingModeModel) {
      return pendingModeModel;
    }

    const snapshot = this.canonicalThreadStateById.get(threadId);
    const snapshotModeModel = normalizeNonEmptyString(
      snapshot?.latestCollaborationMode?.settings.model,
    );
    if (snapshotModeModel) {
      return snapshotModeModel;
    }

    const snapshotLatestModel = normalizeNonEmptyString(snapshot?.latestModel);
    if (snapshotLatestModel) {
      return snapshotLatestModel;
    }

    const readResult = await this.readThread({
      threadId,
      includeTurns: false,
    });
    const threadModeModel = normalizeNonEmptyString(
      readResult.thread.latestCollaborationMode?.settings.model,
    );
    if (threadModeModel) {
      return threadModeModel;
    }

    const threadLatestModel = normalizeNonEmptyString(
      readResult.thread.latestModel,
    );
    if (threadLatestModel) {
      return threadLatestModel;
    }

    const models = await this.runAppServerCall(() => this.appClient.listModels(200));
    const defaultModel = normalizeNonEmptyString(
      models.data.find((entry) => entry.isDefault)?.model,
    );
    if (defaultModel) {
      return defaultModel;
    }

    const firstModel = normalizeNonEmptyString(models.data[0]?.model);
    if (firstModel) {
      return firstModel;
    }

    throw new Error(`No model is available for thread ${threadId}`);
  }

  private resolveVisibleOwnerClientId(
    threadId: string,
    override?: string,
  ): string | null {
    if (override && override.trim().length > 0) {
      return override.trim();
    }
    const mapped = this.threadOwnerById.get(threadId);
    if (mapped && mapped.trim().length > 0) {
      return mapped.trim();
    }
    return null;
  }

  private resolveThreadActionRoute(
    threadId: string,
    ownerClientIdOverride?: string,
  ): ThreadActionRoute {
    const ownerClientId = this.resolveVisibleOwnerClientId(
      threadId,
      ownerClientIdOverride,
    );
    if (ownerClientId) {
      this.recordDesktopThreadOwner(threadId, ownerClientId);
      return {
        kind: "desktop-owner",
        ownerClientId,
      };
    }

    if (this.desktopOwnedThreadIds.has(threadId)) {
      this.throwDisconnectedDesktopOwner(threadId);
    }

    if (this.isIpcReady()) {
      this.throwUnregisteredDesktopOwner(threadId);
    }

    return {
      kind: "app-server",
    };
  }

  private recordDesktopThreadOwner(threadId: string, ownerClientId: string): void {
    this.threadOwnerById.set(threadId, ownerClientId);
    this.desktopOwnedThreadIds.add(threadId);
  }

  private clearVisibleOwnerClientId(
    threadId: string,
    ownerClientId: string,
  ): void {
    const mapped = this.threadOwnerById.get(threadId);
    if (mapped === ownerClientId) {
      this.threadOwnerById.delete(threadId);
    }
  }

  private clearDisconnectedDesktopOwner(
    threadId: string,
    ownerClientId: string,
  ): never {
    this.clearVisibleOwnerClientId(threadId, ownerClientId);
    this.scheduleThreadRefresh(
      threadId,
      null,
      "readThreadWithTurns",
      APP_SERVER_THREAD_REFRESH_DEBOUNCE_MS,
    );
    this.throwDisconnectedDesktopOwner(threadId);
  }

  private throwDisconnectedDesktopOwner(threadId: string): never {
    throw new Error(
      `Codex desktop owner for thread ${threadId} is no longer connected. Reopen this thread in Codex and retry.`,
    );
  }

  private throwUnregisteredDesktopOwner(threadId: string): never {
    throw new Error(
      `Codex desktop owner for thread ${threadId} is not registered. Open this thread in Codex and retry.`,
    );
  }

  private applyPendingCollaborationMode(
    thread: ThreadConversationState,
  ): ThreadConversationState {
    const pendingMode = this.pendingCollaborationModeByThreadId.get(thread.id);
    if (!pendingMode) {
      return thread;
    }

    return {
      ...thread,
      latestCollaborationMode: pendingMode,
      latestModel: pendingMode.settings.model ?? thread.latestModel,
      latestReasoningEffort:
        pendingMode.settings.reasoning_effort ?? thread.latestReasoningEffort,
    };
  }

  private syncActiveTurnIdFromThreadState(
    threadId: string,
    thread: ThreadConversationState,
  ): void {
    const activeTurnId = findActiveTurnId(thread);
    if (!activeTurnId) {
      this.activeTurnIdByThreadId.delete(threadId);
      return;
    }

    this.activeTurnIdByThreadId.set(threadId, activeTurnId);
  }

  private updateActiveTurnFromAppServerNotification(
    notification: AppServerServerNotification,
  ): void {
    const parsedTurnNotification =
      AppServerTurnNotificationEnvelopeSchema.safeParse(notification);
    if (!parsedTurnNotification.success) {
      return;
    }

    const turnId =
      parsedTurnNotification.data.params.turn.turnId ??
      parsedTurnNotification.data.params.turn.id;
    if (!turnId) {
      return;
    }

    if (notification.method === "turn/completed") {
      this.activeTurnIdByThreadId.delete(parsedTurnNotification.data.params.threadId);
      return;
    }

    this.activeTurnIdByThreadId.set(
      parsedTurnNotification.data.params.threadId,
      turnId,
    );
  }

  private notifyThreadStateChanged(threadId: string): void {
    if (this.onThreadStateChange) {
      this.onThreadStateChange(threadId);
    }
  }

  private notifyRuntimeStateChanged(): void {
    if (this.onRuntimeStateChange) {
      this.onRuntimeStateChange();
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
    this.notifyRuntimeStateChanged();
  }

  private patchRuntimeState(patch: Partial<CodexAgentRuntimeState>): void {
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

  private scheduleIpcReconnect(): void {
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

        const initializeResponse = await this.ipcClient.initialize(this.label);
        this.ipcClientId = extractIpcClientId(initializeResponse) ?? null;
        this.patchRuntimeState({
          ipcInitialized: true,
        });
      } catch (error) {
        this.patchRuntimeState({
          ipcInitialized: false,
          ipcConnected: this.ipcClient.isConnected(),
          lastError: toErrorMessage(error),
        });
        this.scheduleIpcReconnect();
      } finally {
        this.bootstrapInFlight = null;
      }
    })();

    return this.bootstrapInFlight;
  }

  private async getActiveTurnId(threadId: string): Promise<string | null> {
    const cachedTurnId = this.activeTurnIdByThreadId.get(threadId);
    if (cachedTurnId) {
      return cachedTurnId;
    }

    const readResult = await this.runAppServerCall(() =>
      this.appClient.readThread(threadId, true),
    );
    const parsedThread = this.applyPendingCollaborationMode(
      parseThreadConversationState(readResult.thread),
    );
    this.syncActiveTurnIdFromThreadState(threadId, parsedThread);
    return this.activeTurnIdByThreadId.get(threadId) ?? null;
  }

  private async resumeThread(threadId: string): Promise<void> {
    await this.runAppServerCall(() =>
      this.appClient.resumeThread(threadId, {
        persistExtendedHistory: true,
      }),
    );
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

    const snapshot = this.canonicalThreadStateById.get(threadId);
    if (!snapshot) {
      return undefined;
    }

    return snapshot.title;
  }

  private setThreadTitle(
    threadId: string,
    title: string | null | undefined,
  ): void {
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

export function isThreadIncludeTurnsUnsupportedAppServerRpcError(
  error: Error | null,
): boolean {
  return (
    isEphemeralThreadIncludeTurnsAppServerRpcError(error) ||
    isThreadNotMaterializedIncludeTurnsAppServerRpcError(error) ||
    isThreadNoRolloutIncludeTurnsAppServerRpcError(error)
  );
}

function isIncludeTurnsUnsupportedAppServerRpcErrorMessage(
  message: string,
): boolean {
  const normalized = message.trim().toLowerCase();
  return (
    normalized.includes("app-server error -32600") &&
    normalized.includes("includeturns") &&
    (normalized.includes("ephemeral threads") ||
      normalized.includes("not materialized yet") ||
      normalized.includes("no rollout found for thread id"))
  );
}

export function isEphemeralThreadIncludeTurnsAppServerRpcError(
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
    normalized.includes("ephemeral threads") &&
    normalized.includes("includeturns")
  );
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
  return isIpcNoClientFoundMessage(error.message);
}

function isIpcNoClientFoundMessage(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return normalized.includes("no-client-found");
}

function normalizeStderrLine(line: string): string {
  return line.replace(ANSI_ESCAPE_REGEX, "").trim();
}

function normalizeNonEmptyString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
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
  let waitingOnApproval =
    state.status?.type === "active" &&
    state.status.activeFlags.includes("waitingOnApproval");
  let waitingOnUserInput =
    state.status?.type === "active" &&
    state.status.activeFlags.includes("waitingOnUserInput");

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

function extractThreadIdFromConversationRequest(
  request: ThreadConversationRequest,
): string | null {
  switch (request.method) {
    case "item/commandExecution/requestApproval":
    case "item/fileChange/requestApproval":
    case "item/tool/requestUserInput":
    case "item/tool/call":
    case "item/plan/requestImplementation":
      return request.params.threadId;
    case "applyPatchApproval":
    case "execCommandApproval":
      return request.params.conversationId;
    case "account/chatgptAuthTokens/refresh":
      return null;
  }
  return null;
}

function isTerminalTurnStatus(status: string): boolean {
  const normalized = status.trim().toLowerCase();
  return (
    normalized === "completed" ||
    normalized === "failed" ||
    normalized === "error" ||
    normalized === "cancelled" ||
    normalized === "canceled" ||
    normalized === "interrupted" ||
    normalized === "aborted"
  );
}

function findActiveTurnId(state: ThreadConversationState): string | null {
  for (let index = state.turns.length - 1; index >= 0; index -= 1) {
    const turn = state.turns[index];
    if (!turn || isTerminalTurnStatus(turn.status)) {
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

export function mergeThreadConversationStates(
  currentThread: ThreadConversationState,
  nextReadThread: ThreadConversationState,
): ThreadConversationState {
  const normalizedCurrentThread = normalizeThreadConversationState(currentThread);
  const normalizedNextReadThread =
    normalizeThreadConversationState(nextReadThread);
  return parseThreadConversationState({
    ...normalizedCurrentThread,
    ...normalizedNextReadThread,
    turns: mergeThreadTurns(
      normalizedCurrentThread.turns,
      normalizedNextReadThread.turns,
    ),
    requests: mergeThreadRequests(
      normalizedCurrentThread.requests,
      normalizedNextReadThread.requests,
    ),
  });
}

function normalizeThreadConversationState(
  thread: ThreadConversationState,
): ThreadConversationState {
  return parseThreadConversationState({
    ...thread,
    turns: mergeThreadTurns(
      thread.turns.map((turn) =>
        ThreadTurnSchema.parse({
          ...turn,
          items: mergeTurnItems(turn.items, []),
        }),
      ),
      [],
    ),
  });
}

function mergeThreadTurns(
  currentTurns: ThreadTurn[],
  nextTurns: ThreadTurn[],
): ThreadTurn[] {
  const nextTurnsByKey = new Map<string, ThreadTurn>();
  for (const nextTurn of nextTurns) {
    for (const key of threadTurnKeys(nextTurn)) {
      nextTurnsByKey.set(key, nextTurn);
    }
  }

  const mergedTurns: ThreadTurn[] = [];
  const seenKeys = new Set<string>();
  for (const currentTurn of currentTurns) {
    const currentKeys = threadTurnKeys(currentTurn);
    if (currentKeys.some((key) => seenKeys.has(key))) {
      continue;
    }
    if (currentKeys.length === 0) {
      mergedTurns.push(currentTurn);
      continue;
    }

    const nextTurn =
      currentKeys.map((key) => nextTurnsByKey.get(key)).find(Boolean) ?? null;
    if (!nextTurn) {
      mergedTurns.push(currentTurn);
      for (const key of currentKeys) {
        seenKeys.add(key);
      }
      continue;
    }

    mergedTurns.push(mergeThreadTurn(currentTurn, nextTurn));
    for (const key of [
      ...currentKeys,
      ...threadTurnKeys(nextTurn),
    ]) {
      seenKeys.add(key);
    }
  }

  for (const nextTurn of nextTurns) {
    const nextKeys = threadTurnKeys(nextTurn);
    if (nextKeys.length === 0) {
      mergedTurns.push(nextTurn);
      continue;
    }
    if (nextKeys.some((key) => seenKeys.has(key))) {
      continue;
    }
    mergedTurns.push(nextTurn);
    for (const key of nextKeys) {
      seenKeys.add(key);
    }
  }

  return orderThreadTurnsByStartTime(mergedTurns);
}

function orderThreadTurnsByStartTime(turns: ThreadTurn[]): ThreadTurn[] {
  return turns
    .map((turn, index) => ({
      turn,
      index,
      sortTimeMs: readTurnSortTimeMs(turn),
    }))
    .sort((left, right) => {
      if (left.sortTimeMs === null || right.sortTimeMs === null) {
        return left.index - right.index;
      }
      if (left.sortTimeMs === right.sortTimeMs) {
        return left.index - right.index;
      }
      return left.sortTimeMs - right.sortTimeMs;
    })
    .map((entry) => entry.turn);
}

function readTurnSortTimeMs(turn: ThreadTurn): number | null {
  return (
    turn.turnStartedAtMs ??
    readUuidV7TimestampMs(turn.turnId) ??
    readUuidV7TimestampMs(turn.id) ??
    readUlidTimestampMs(turn.turnId) ??
    readUlidTimestampMs(turn.id)
  );
}

const UUID_V7_TIMESTAMP_ALPHABET = "0123456789ABCDEF";
const ULID_TIMESTAMP_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function readUuidV7TimestampMs(value: string | null | undefined): number | null {
  const normalized = normalizeNonEmptyString(value);
  if (!normalized) {
    return null;
  }

  let timestampMs = 0;
  let digitCount = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index] ?? "";
    if (char === "-") {
      continue;
    }
    const digit = UUID_V7_TIMESTAMP_ALPHABET.indexOf(char.toUpperCase());
    if (digit < 0) {
      return null;
    }
    timestampMs = timestampMs * 16 + digit;
    digitCount += 1;
    if (digitCount === 12) {
      return timestampMs;
    }
  }

  return null;
}

function readUlidTimestampMs(value: string | null | undefined): number | null {
  const normalized = normalizeNonEmptyString(value);
  if (!normalized || normalized.length < 10) {
    return null;
  }

  let timestampMs = 0;
  for (let index = 0; index < 10; index += 1) {
    const digit = ULID_TIMESTAMP_ALPHABET.indexOf(
      normalized[index]?.toUpperCase() ?? "",
    );
    if (digit < 0) {
      return null;
    }
    timestampMs = timestampMs * 32 + digit;
  }
  return timestampMs;
}

function mergeThreadTurn(
  currentTurn: ThreadTurn,
  nextTurn: ThreadTurn,
): ThreadTurn {
  const preferNextTurn =
    nextTurn.turnId !== undefined || currentTurn.turnId === undefined;
  return ThreadTurnSchema.parse({
    ...(preferNextTurn ? currentTurn : nextTurn),
    ...(preferNextTurn ? nextTurn : currentTurn),
    turnId: nextTurn.turnId ?? currentTurn.turnId,
    items: preferNextTurn
      ? mergeTurnItems(nextTurn.items, currentTurn.items, "current")
      : mergeTurnItems(currentTurn.items, nextTurn.items, "current"),
  });
}

function threadTurnKeys(turn: ThreadTurn): string[] {
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

function mergeTurnItems(
  currentItems: TurnItem[],
  nextItems: TurnItem[],
  preferredItem: "current" | "next" = "next",
): TurnItem[] {
  const nextItemsByKey = new Map<string, TurnItem>();
  for (const nextItem of nextItems) {
    for (const key of turnItemKeys(nextItem)) {
      nextItemsByKey.set(key, nextItem);
    }
  }
  const mergedItems: TurnItem[] = [];
  const seenKeys = new Set<string>();

  for (const currentItem of currentItems) {
    const currentItemKeys = turnItemKeys(currentItem);
    if (currentItemKeys.some((key) => seenKeys.has(key))) {
      continue;
    }
    const nextItem =
      currentItemKeys
        .map((key) => nextItemsByKey.get(key))
        .find(Boolean) ?? null;
    if (!nextItem) {
      mergedItems.push(currentItem);
      for (const key of currentItemKeys) {
        seenKeys.add(key);
      }
      continue;
    }

    mergedItems.push(
      preferredItem === "current"
        ? mergeTurnItem(nextItem, currentItem)
        : mergeTurnItem(currentItem, nextItem),
    );
    for (const key of [
      ...currentItemKeys,
      ...turnItemKeys(nextItem),
    ]) {
      seenKeys.add(key);
    }
  }

  for (const nextItem of nextItems) {
    const nextItemKeys = turnItemKeys(nextItem);
    if (nextItemKeys.some((key) => seenKeys.has(key))) {
      continue;
    }
    mergedItems.push(nextItem);
    for (const key of nextItemKeys) {
      seenKeys.add(key);
    }
  }

  return mergedItems;
}

function turnItemKeys(item: TurnItem): string[] {
  const keys = [`id:${item.type}:${turnItemId(item)}`];
  const contentKey = turnItemContentKey(item);
  if (contentKey) {
    keys.push(contentKey);
  }
  return keys;
}

function turnItemId(item: TurnItem): string {
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

function turnItemContentKey(item: TurnItem): string | null {
  switch (item.type) {
    case "agentMessage":
      return `agentMessage:${item.text}`;
    case "userMessage":
    case "steeringUserMessage":
      return `${item.type}:${userMessageContentKey(item.content)}`;
    default:
      return null;
  }
}

function userMessageContentKey(
  content: Extract<TurnItem, { type: "userMessage" | "steeringUserMessage" }>["content"],
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
      }
    })
    .join("\n");
}

function mergeTurnItem(currentItem: TurnItem, nextItem: TurnItem): TurnItem {
  if (currentItem.type !== nextItem.type) {
    return nextItem;
  }

  return TurnItemSchema.parse({
    ...currentItem,
    ...nextItem,
  });
}

function mergeThreadRequests(
  currentRequests: ThreadConversationRequest[],
  nextRequests: ThreadConversationRequest[],
): ThreadConversationRequest[] {
  const nextRequestsByKey = new Map(
    nextRequests.map((request) => [threadRequestKey(request), request]),
  );
  const mergedRequests: ThreadConversationRequest[] = [];
  const seenKeys = new Set<string>();

  for (const currentRequest of currentRequests) {
    const key = threadRequestKey(currentRequest);
    const nextRequest = nextRequestsByKey.get(key);
    if (!nextRequest) {
      mergedRequests.push(currentRequest);
      continue;
    }

    mergedRequests.push(
      ThreadConversationRequestSchema.parse({
        ...currentRequest,
        ...nextRequest,
      }),
    );
    seenKeys.add(key);
  }

  for (const nextRequest of nextRequests) {
    const key = threadRequestKey(nextRequest);
    if (seenKeys.has(key)) {
      continue;
    }
    mergedRequests.push(nextRequest);
  }

  return mergedRequests;
}

function threadRequestKey(request: ThreadConversationRequest): string {
  return `${request.method}:${String(request.id)}`;
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

const AppServerThreadIdParamsSchema = z
  .object({
    threadId: z.string().min(1),
  })
  .passthrough();

const AppServerThreadStartedNotificationSchema = z
  .object({
    method: z.literal("thread/started"),
    params: z
      .object({
        thread: z
          .object({
            id: z.string().min(1),
          })
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough();

const AppServerTurnNotificationEnvelopeSchema = z
  .object({
    method: z.union([z.literal("turn/started"), z.literal("turn/completed")]),
    params: z
      .object({
        threadId: z.string().min(1),
        turn: z
          .object({
            id: z.string().min(1).optional(),
            turnId: z.string().min(1).optional(),
          })
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough();

const AppServerThreadStartedStateNotificationSchema = z
  .object({
    method: z.literal("thread/started"),
    params: z
      .object({
        thread: JsonValueSchema,
      })
      .passthrough(),
  })
  .passthrough();

const AppServerTurnThreadNotificationSchema = z
  .object({
    method: z.union([z.literal("turn/started"), z.literal("turn/completed")]),
    params: z
      .object({
        threadId: z.string().min(1),
        turn: ThreadTurnSchema,
      })
      .passthrough(),
  })
  .passthrough();

const AppServerItemThreadNotificationSchema = z
  .object({
    method: z.union([z.literal("item/started"), z.literal("item/completed")]),
    params: z
      .object({
        threadId: z.string().min(1),
        turnId: z.string().min(1),
        item: TurnItemSchema,
      })
      .passthrough(),
  })
  .passthrough();

const AppServerItemDeltaBaseSchema = z
  .object({
    threadId: z.string().min(1),
    turnId: z.string().min(1),
    itemId: z.string().min(1),
    delta: z.string(),
  })
  .passthrough();

const AppServerAgentMessageDeltaNotificationSchema = z
  .object({
    method: z.literal("item/agentMessage/delta"),
    params: AppServerItemDeltaBaseSchema,
  })
  .passthrough();

const AppServerPlanDeltaNotificationSchema = z
  .object({
    method: z.literal("item/plan/delta"),
    params: AppServerItemDeltaBaseSchema,
  })
  .passthrough();

const AppServerCommandOutputDeltaNotificationSchema = z
  .object({
    method: z.literal("item/commandExecution/outputDelta"),
    params: AppServerItemDeltaBaseSchema,
  })
  .passthrough();

const AppServerReasoningTextDeltaNotificationSchema = z
  .object({
    method: z.literal("item/reasoning/textDelta"),
    params: AppServerItemDeltaBaseSchema
      .extend({
        contentIndex: z.number().int().nonnegative(),
      })
      .passthrough(),
  })
  .passthrough();

const AppServerReasoningSummaryPartAddedNotificationSchema = z
  .object({
    method: z.literal("item/reasoning/summaryPartAdded"),
    params: z
      .object({
        threadId: z.string().min(1),
        turnId: z.string().min(1),
        itemId: z.string().min(1),
        summaryIndex: z.number().int().nonnegative(),
      })
      .passthrough(),
  })
  .passthrough();

const AppServerReasoningSummaryTextDeltaNotificationSchema = z
  .object({
    method: z.literal("item/reasoning/summaryTextDelta"),
    params: AppServerItemDeltaBaseSchema
      .extend({
        summaryIndex: z.number().int().nonnegative(),
      })
      .passthrough(),
  })
  .passthrough();

const AppServerThreadTokenUsageUpdatedNotificationSchema = z
  .object({
    method: z.literal("thread/tokenUsage/updated"),
    params: z
      .object({
        threadId: z.string().min(1),
        turnId: z.string().min(1),
        tokenUsage: JsonValueSchema,
      })
      .passthrough(),
  })
  .passthrough();

const AppServerThreadStatusChangedNotificationSchema = z
  .object({
    method: z.literal("thread/status/changed"),
    params: z
      .object({
        threadId: z.string().min(1),
        status: ThreadStatusSchema,
      })
      .passthrough(),
  })
  .passthrough();

const AppServerThreadNameUpdatedNotificationSchema = z
  .object({
    method: z.literal("thread/name/updated"),
    params: z
      .object({
        threadId: z.string().min(1),
        threadName: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough();

const AppServerTurnDiffUpdatedNotificationSchema = z
  .object({
    method: z.literal("turn/diff/updated"),
    params: z
      .object({
        threadId: z.string().min(1),
        turnId: z.string().min(1),
        diff: z.string(),
      })
      .passthrough(),
  })
  .passthrough();

const AppServerTurnPlanStepSchema = z
  .object({
    step: z.string(),
    status: z.string(),
  })
  .passthrough();

const AppServerTurnPlanUpdatedNotificationSchema = z
  .object({
    method: z.literal("turn/plan/updated"),
    params: z
      .object({
        threadId: z.string().min(1),
        turnId: z.string().min(1),
        explanation: z.union([z.string(), z.null()]),
        plan: z.array(AppServerTurnPlanStepSchema),
      })
      .passthrough(),
  })
  .passthrough();

const AppServerTerminalInteractionNotificationSchema = z
  .object({
    method: z.literal("item/commandExecution/terminalInteraction"),
    params: z
      .object({
        threadId: z.string().min(1),
        turnId: z.string().min(1),
        itemId: z.string().min(1),
        processId: z.string().min(1),
        stdin: z.string(),
      })
      .passthrough(),
  })
  .passthrough();

const AppServerFileChangeOutputDeltaNotificationSchema = z
  .object({
    method: z.literal("item/fileChange/outputDelta"),
    params: AppServerItemDeltaBaseSchema,
  })
  .passthrough();

const AppServerMcpToolCallProgressNotificationSchema = z
  .object({
    method: z.literal("item/mcpToolCall/progress"),
    params: z
      .object({
        threadId: z.string().min(1),
        turnId: z.string().min(1),
        itemId: z.string().min(1),
        message: z.string(),
      })
      .passthrough(),
  })
  .passthrough();

const AppServerThreadCompactedNotificationSchema = z
  .object({
    method: z.literal("thread/compacted"),
    params: z
      .object({
        threadId: z.string().min(1),
        turnId: z.string().min(1),
      })
      .passthrough(),
  })
  .passthrough();

const AppServerModelReroutedNotificationSchema = z
  .object({
    method: z.literal("model/rerouted"),
    params: z
      .object({
        threadId: z.string().min(1),
        turnId: z.string().min(1),
        fromModel: z.string(),
        toModel: z.string(),
      })
      .passthrough(),
  })
  .passthrough();

const AppServerErrorNotificationSchema = z
  .object({
    method: z.literal("error"),
    params: z
      .object({
        threadId: z.string().min(1),
        turnId: z.string().min(1),
        willRetry: z.boolean(),
        error: z
          .object({
            message: z.string(),
            codexErrorInfo: JsonValueSchema.nullable(),
            additionalDetails: z.union([z.string(), z.null()]),
          })
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough();

function upsertTurnIntoThread(
  thread: ThreadConversationState,
  nextTurn: ThreadTurn,
): ThreadConversationState {
  const nextTurns = [...thread.turns];
  const matchIndex = nextTurns.findIndex((turn) => turnsMatch(turn, nextTurn));
  if (matchIndex === -1) {
    nextTurns.push(nextTurn);
  } else {
    const currentTurn = nextTurns[matchIndex];
    if (!currentTurn) {
      return thread;
    }
    nextTurns[matchIndex] = {
      ...currentTurn,
      ...nextTurn,
      params: nextTurn.params ?? currentTurn.params,
      turnId: nextTurn.turnId ?? currentTurn.turnId,
      id: nextTurn.id ?? currentTurn.id,
      turnStartedAtMs:
        nextTurn.turnStartedAtMs ?? currentTurn.turnStartedAtMs,
      finalAssistantStartedAtMs:
        nextTurn.finalAssistantStartedAtMs ??
        currentTurn.finalAssistantStartedAtMs,
      error: nextTurn.error ?? currentTurn.error,
      diff: nextTurn.diff ?? currentTurn.diff,
      items:
        nextTurn.items.length > 0 ? nextTurn.items : currentTurn.items,
    };
  }
  return {
    ...thread,
    turns: nextTurns,
  };
}

function updateThreadTurn(
  thread: ThreadConversationState,
  turnId: string,
  update: (turn: ThreadTurn) => ThreadTurn,
): ThreadConversationState | null {
  const nextTurns = [...thread.turns];
  const turnIndex = nextTurns.findIndex((turn) => turnMatchesId(turn, turnId));
  if (turnIndex === -1) {
    return null;
  }

  const turn = nextTurns[turnIndex];
  if (!turn) {
    return null;
  }

  nextTurns[turnIndex] = update(turn);
  return {
    ...thread,
    turns: nextTurns,
  };
}

function updateThreadItem(
  thread: ThreadConversationState,
  turnId: string,
  itemId: string,
  update: (item: TurnItem) => TurnItem,
): ThreadConversationState | null {
  const nextTurns = [...thread.turns];
  const turnIndex = nextTurns.findIndex((turn) => turnMatchesId(turn, turnId));
  if (turnIndex === -1) {
    return null;
  }

  const turn = nextTurns[turnIndex];
  if (!turn) {
    return null;
  }

  const nextItems = [...turn.items];
  const itemIndex = nextItems.findIndex((item) => turnItemId(item) === itemId);
  if (itemIndex === -1) {
    return null;
  }

  const currentItem = nextItems[itemIndex];
  if (!currentItem) {
    return null;
  }

  nextItems[itemIndex] = update(currentItem);
  nextTurns[turnIndex] = {
    ...turn,
    items: nextItems,
  };
  return {
    ...thread,
    turns: nextTurns,
  };
}

function upsertTurnItem(
  thread: ThreadConversationState,
  turnId: string,
  nextItem: TurnItem,
): ThreadConversationState | null {
  const nextTurns = [...thread.turns];
  const turnIndex = nextTurns.findIndex((turn) => turnMatchesId(turn, turnId));
  if (turnIndex === -1) {
    return null;
  }

  const turn = nextTurns[turnIndex];
  if (!turn) {
    return null;
  }

  const nextItems = [...turn.items];
  const nextItemId = turnItemId(nextItem);
  const itemIndex = nextItems.findIndex(
    (item) => turnItemId(item) === nextItemId,
  );
  if (itemIndex === -1) {
    nextItems.push(nextItem);
  } else {
    nextItems[itemIndex] = nextItem;
  }

  nextTurns[turnIndex] = {
    ...turn,
    items: nextItems,
  };
  return {
    ...thread,
    turns: nextTurns,
  };
}

function buildSyntheticTurnItemId(prefix: string, turnId: string): string {
  return `${prefix}:${turnId}`;
}

function shouldBroadcastThreadSnapshotForAppServerNotification(
  method: AppServerServerNotification["method"],
): boolean {
  switch (method) {
    case "turn/plan/updated":
    case "thread/compacted":
    case "model/rerouted":
    case "error":
      return false;
    default:
      return true;
  }
}

function turnMatchesId(turn: ThreadTurn, turnId: string): boolean {
  return turn.turnId === turnId || turn.id === turnId;
}

function turnsMatch(left: ThreadTurn, right: ThreadTurn): boolean {
  if (left.turnId && right.turnId) {
    return left.turnId === right.turnId;
  }
  if (left.id && right.id) {
    return left.id === right.id;
  }
  return false;
}

function extractIpcClientId(frame: IpcResponseFrame): string | null {
  const parsed = z
    .object({
      result: z
        .object({
          clientId: z.string().min(1),
        })
        .passthrough()
        .optional(),
    })
    .passthrough()
    .safeParse(frame);
  if (!parsed.success) {
    return null;
  }
  return parsed.data.result?.clientId ?? null;
}

function extractThreadIdFromAppServerNotification(
  notification: AppServerServerNotification,
): string | null {
  const directThreadId = AppServerThreadIdParamsSchema.safeParse(
    notification.params,
  );
  if (directThreadId.success) {
    return directThreadId.data.threadId;
  }

  const startedThread = AppServerThreadStartedNotificationSchema.safeParse(
    notification,
  );
  if (startedThread.success) {
    return startedThread.data.params.thread.id;
  }

  return null;
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

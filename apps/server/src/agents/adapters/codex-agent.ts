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
  parseThreadConversationState,
  parseThreadStreamStateChangedBroadcast,
  parseUserInputResponsePayload,
  type IpcFrame,
  type IpcRequestFrame,
  type IpcResponseFrame,
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
  };

  private readonly appClient: AppServerClient;
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
  private readonly ipcFrameListeners = new Set<
    (event: CodexIpcFrameEvent) => void
  >();
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
      if (sourceClientId) {
        this.lastKnownOwnerClientId = sourceClientId;
      }

      this.emitIpcFrame({
        direction: "in",
        frame,
        method,
        threadId,
      });

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
        this.threadOwnerById.set(conversationId, sourceClientId);
      }

      const current = this.streamEventsByThreadId.get(conversationId) ?? [];
      current.push(frame);
      if (current.length > 400) {
        current.splice(0, current.length - 400);
      }
      this.streamEventsByThreadId.set(conversationId, current);

      try {
        const parsedBroadcast = parseThreadStreamStateChangedBroadcast(frame);
        if (parsedBroadcast.params.change.type !== "snapshot") {
          return;
        }

        const snapshot = parsedBroadcast.params.change.conversationState;
        this.streamSnapshotByThreadId.set(conversationId, snapshot);
        this.streamSnapshotOriginByThreadId.set(conversationId, "stream");
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
    const parsedThread = parseThreadConversationState(result.thread);
    const existingSnapshot = this.streamSnapshotByThreadId.get(input.threadId);
    const shouldStoreSnapshot =
      input.includeTurns ||
      parsedThread.turns.length > 0 ||
      existingSnapshot === undefined;
    if (shouldStoreSnapshot) {
      this.streamSnapshotByThreadId.set(input.threadId, parsedThread);
      const snapshotOrigin: StreamSnapshotOrigin =
        input.includeTurns && parsedThread.turns.length > 0
          ? "readThreadWithTurns"
          : "readThread";
      this.streamSnapshotOriginByThreadId.set(input.threadId, snapshotOrigin);
    }
    this.setThreadTitle(input.threadId, parsedThread.title);
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
      this.threadOwnerById.set(input.threadId, ownerClientId);
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
    this.ensureIpcReady();

    const ownerClientId = resolveOwnerClientId(
      this.threadOwnerById,
      input.threadId,
      input.ownerClientId,
      this.lastKnownOwnerClientId ?? undefined,
    );

    await this.service.submitUserInput({
      threadId: input.threadId,
      ownerClientId,
      requestId: input.requestId,
      response: parseUserInputResponsePayload(input.response),
    });

    return {
      ownerClientId,
      requestId: input.requestId,
    };
  }

  public async readLiveState(threadId: string): Promise<AgentThreadLiveState> {
    const snapshotState = this.streamSnapshotByThreadId.get(threadId) ?? null;
    const snapshotOrigin =
      this.streamSnapshotOriginByThreadId.get(threadId) ?? null;
    const ownerClientId =
      this.threadOwnerById.get(threadId) ?? this.lastKnownOwnerClientId ?? null;
    const rawEvents = this.streamEventsByThreadId.get(threadId) ?? [];
    if (rawEvents.length === 0) {
      return {
        ownerClientId,
        conversationState: snapshotState,
        liveStateError: null,
      };
    }

    const events: ReturnType<typeof parseThreadStreamStateChangedBroadcast>[] =
      [];

    for (let eventIndex = 0; eventIndex < rawEvents.length; eventIndex += 1) {
      const event = rawEvents[eventIndex];
      try {
        events.push(parseThreadStreamStateChangedBroadcast(event));
      } catch (error) {
        logger.error(
          {
            threadId,
            eventIndex,
            error: toErrorMessage(error),
            ...(error instanceof ProtocolValidationError
              ? { issues: error.issues }
              : {}),
          },
          "thread-stream-event-parse-failed",
        );
        return {
          ownerClientId,
          conversationState: snapshotState,
          liveStateError: {
            kind: "parseFailed",
            message: toErrorMessage(error),
            eventIndex,
            patchIndex: null,
          },
        };
      }
    }

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
            snapshotState,
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
        this.scheduleIpcReconnect();
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

    const snapshot = this.streamSnapshotByThreadId.get(threadId);
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
  if (
    frame.type === "broadcast" &&
    frame.method === "thread-stream-state-changed"
  ) {
    const params = frame.params;
    if (!params || typeof params !== "object") {
      return null;
    }

    const conversationId = (params as Record<string, string>)["conversationId"];
    if (typeof conversationId === "string" && conversationId.trim()) {
      return conversationId.trim();
    }

    return null;
  }

  if (frame.type !== "request") {
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

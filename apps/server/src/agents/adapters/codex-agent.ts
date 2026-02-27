import fs from "node:fs";
import path from "node:path";
import {
  AppServerClient,
  AppServerRpcError,
  AppServerTransportError,
  CodexMonitorService,
  DesktopIpcClient,
  reduceThreadStreamEvents,
  ThreadStreamReductionError,
  type SendRequestOptions
} from "@farfield/api";
import {
  parseThreadConversationState,
  parseThreadStreamStateChangedBroadcast,
  parseUserInputResponsePayload,
  ProtocolValidationError,
  type IpcFrame,
  type IpcRequestFrame,
  type IpcResponseFrame,
  type ThreadConversationState,
  type ThreadStreamStateChangedBroadcast,
  type UserInputRequestId
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
  AgentThreadStreamEvents
} from "../types.js";

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
const INVALID_STREAM_EVENTS_LOG_PATH = process.env["FARFIELD_INVALID_STREAM_LOG_PATH"] ??
  path.resolve(process.cwd(), "invalid-thread-stream-events.jsonl");

export class CodexAgentAdapter implements AgentAdapter {
  public readonly id = "codex";
  public readonly label = "Codex";
  public readonly capabilities: AgentCapabilities = {
    canListModels: true,
    canListCollaborationModes: true,
    canSetCollaborationMode: true,
    canSubmitUserInput: true,
    canReadLiveState: true,
    canReadStreamEvents: true
  };

  private readonly appClient: AppServerClient;
  private readonly ipcClient: DesktopIpcClient;
  private readonly service: CodexMonitorService;
  private readonly onStateChange: (() => void) | null;
  private readonly reconnectDelayMs: number;

  private readonly threadOwnerById = new Map<string, string>();
  private readonly streamEventsByThreadId = new Map<string, IpcFrame[]>();
  private readonly streamSnapshotByThreadId = new Map<string, ThreadConversationState>();
  private readonly threadTitleById = new Map<string, string | null>();
  private readonly ipcFrameListeners = new Set<(event: CodexIpcFrameEvent) => void>();
  private lastKnownOwnerClientId: string | null = null;

  private runtimeState: CodexAgentRuntimeState = {
    appReady: false,
    ipcConnected: false,
    ipcInitialized: false,
    codexAvailable: true,
    lastError: null
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
        if (isKnownBenignAppServerStderr(normalized)) {
          logger.debug({ line: normalized }, "codex-app-server-stderr-ignored");
          return;
        }
        logger.error({ line: normalized }, "codex-app-server-stderr");
      }
    });

    this.ipcClient = new DesktopIpcClient({
      socketPath: options.socketPath
    });
    this.service = new CodexMonitorService(this.ipcClient);

    this.ipcClient.onConnectionState((state) => {
      this.patchRuntimeState({
        ipcConnected: state.connected,
        ipcInitialized: state.connected ? this.runtimeState.ipcInitialized : false,
        ...(state.reason ? { lastError: state.reason } : {})
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
      const method = frame.type === "request" || frame.type === "broadcast"
        ? frame.method
        : frame.type === "response"
          ? frame.method ?? "response"
          : frame.type;

      const sourceClientIdRaw = (
        frame.type === "request" || frame.type === "broadcast"
      )
        ? frame.sourceClientId
        : undefined;
      const sourceClientId = typeof sourceClientIdRaw === "string"
        ? sourceClientIdRaw.trim()
        : "";
      if (sourceClientId) {
        this.lastKnownOwnerClientId = sourceClientId;
      }

      this.emitIpcFrame({
        direction: "in",
        frame,
        method,
        threadId
      });

      if (frame.type !== "broadcast" || frame.method !== "thread-stream-state-changed") {
        return;
      }

      const params = frame.params;
      if (!params || typeof params !== "object") {
        return;
      }

      const conversationId = (params as Record<string, string>)["conversationId"];
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

      const parsedBroadcast = parseIncomingThreadStreamBroadcast(frame);
      if (!parsedBroadcast) {
        return;
      }

      if (parsedBroadcast.params.change.type !== "snapshot") {
        return;
      }

      const snapshot = parsedBroadcast.params.change.conversationState;
      this.streamSnapshotByThreadId.set(conversationId, snapshot);
      this.setThreadTitle(conversationId, snapshot.title);
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

  public isThreadNotLoadedError(error: Error): boolean {
    if (!(error instanceof AppServerRpcError)) {
      return false;
    }

    if (error.code !== -32600) {
      return false;
    }

    return error.message.includes("thread not loaded");
  }

  public isConversationNotFoundError(error: unknown): boolean {
    if (!(error instanceof AppServerRpcError)) {
      return false;
    }

    if (error.code !== -32600) {
      return false;
    }

    return error.message.includes("conversation not found");
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

  public async listThreads(input: AgentListThreadsInput): Promise<AgentListThreadsResult> {
    this.ensureCodexAvailable();

    const result = await this.runAppServerCall(() =>
      input.all
        ? this.appClient.listThreadsAll(
            input.cursor
              ? {
                  limit: input.limit,
                  archived: input.archived,
                  cursor: input.cursor,
                  maxPages: input.maxPages
                }
              : {
                  limit: input.limit,
                  archived: input.archived,
                  maxPages: input.maxPages
                }
          )
        : this.appClient.listThreads(
            input.cursor
              ? {
                  limit: input.limit,
                  archived: input.archived,
                  cursor: input.cursor
                }
              : {
                  limit: input.limit,
                  archived: input.archived
                }
          )
    );

    const data = result.data.map((thread) => {
      const title = this.resolveThreadTitle(thread.id, thread.title);
      if (title === undefined) {
        return thread;
      }

      return {
        ...thread,
        title
      };
    });

    return {
      data,
      nextCursor: result.nextCursor ?? null,
      ...(typeof result.pages === "number" ? { pages: result.pages } : {}),
      ...(typeof result.truncated === "boolean" ? { truncated: result.truncated } : {})
    };
  }

  public async createThread(input: AgentCreateThreadInput): Promise<AgentCreateThreadResult> {
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
        ...(input.approvalPolicy ? { approvalPolicy: input.approvalPolicy } : {}),
        ...(typeof input.ephemeral === "boolean" ? { ephemeral: input.ephemeral } : {})
      })
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
      reasoningEffort: result.reasoningEffort
    };
  }

  public async readThread(input: AgentReadThreadInput): Promise<AgentReadThreadResult> {
    this.ensureCodexAvailable();
    const result = await this.runAppServerCall(() =>
      this.appClient.readThread(input.threadId, input.includeTurns)
    );
    const parsedThread = parseThreadConversationState(result.thread);
    this.streamSnapshotByThreadId.set(input.threadId, parsedThread);
    this.setThreadTitle(input.threadId, parsedThread.title);
    return {
      thread: parsedThread
    };
  }

  public async sendMessage(input: AgentSendMessageInput): Promise<void> {
    this.ensureCodexAvailable();
    const text = input.text.trim();
    if (text.length === 0) {
      throw new Error("Message text is required");
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
          input: [{ type: "text", text }]
        });
        return;
      }

      await this.appClient.startTurn({
        threadId: input.threadId,
        input: [{ type: "text", text }],
        ...(input.cwd ? { cwd: input.cwd } : {}),
        attachments: []
      });
    };

    try {
      await this.runAppServerCall(sendTurn);
      return;
    } catch (error) {
      if (!this.isConversationNotFoundError(error)) {
        throw error;
      }
    }

    await this.runAppServerCall(() =>
      this.appClient.resumeThread(input.threadId, { persistExtendedHistory: true })
    );
    await this.runAppServerCall(sendTurn);
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

    try {
      await this.runAppServerCall(interruptTurn);
      return;
    } catch (error) {
      if (!this.isConversationNotFoundError(error)) {
        throw error;
      }
    }

    await this.runAppServerCall(() =>
      this.appClient.resumeThread(input.threadId, { persistExtendedHistory: true })
    );
    await this.runAppServerCall(interruptTurn);
  }

  public async listModels(limit: number) {
    this.ensureCodexAvailable();
    return this.runAppServerCall(() => this.appClient.listModels(limit));
  }

  public async listCollaborationModes() {
    this.ensureCodexAvailable();
    return this.runAppServerCall(() => this.appClient.listCollaborationModes());
  }

  public async setCollaborationMode(input: AgentSetCollaborationModeInput): Promise<{ ownerClientId: string }> {
    this.ensureCodexAvailable();
    this.ensureIpcReady();

    const ownerClientId = resolveOwnerClientId(
      this.threadOwnerById,
      input.threadId,
      input.ownerClientId,
      this.lastKnownOwnerClientId ?? undefined
    );

    await this.service.setCollaborationMode({
      threadId: input.threadId,
      ownerClientId,
      collaborationMode: input.collaborationMode
    });

    return {
      ownerClientId
    };
  }

  public async submitUserInput(
    input: AgentSubmitUserInputInput
  ): Promise<{ ownerClientId: string; requestId: UserInputRequestId }> {
    this.ensureCodexAvailable();
    this.ensureIpcReady();

    const ownerClientId = resolveOwnerClientId(
      this.threadOwnerById,
      input.threadId,
      input.ownerClientId,
      this.lastKnownOwnerClientId ?? undefined
    );

    await this.service.submitUserInput({
      threadId: input.threadId,
      ownerClientId,
      requestId: input.requestId,
      response: parseUserInputResponsePayload(input.response)
    });

    return {
      ownerClientId,
      requestId: input.requestId
    };
  }

  public async readLiveState(threadId: string): Promise<AgentThreadLiveState> {
    const snapshotState = this.streamSnapshotByThreadId.get(threadId) ?? null;
    const ownerClientId = this.threadOwnerById.get(threadId)
      ?? this.lastKnownOwnerClientId
      ?? null;
    const rawEvents = this.streamEventsByThreadId.get(threadId) ?? [];
    if (rawEvents.length === 0) {
      return {
        ownerClientId,
        conversationState: snapshotState,
        liveStateError: null
      };
    }

    const events: ReturnType<typeof parseThreadStreamStateChangedBroadcast>[] = [];
    const validRawEvents: IpcFrame[] = [];
    let invalidEventCount = 0;
    let firstInvalidEventError: string | null = null;
    let firstInvalidEventMessage: string | null = null;

    for (const event of rawEvents) {
      try {
        events.push(parseThreadStreamStateChangedBroadcast(event));
        validRawEvents.push(event);
      } catch (error) {
        invalidEventCount += 1;
        if (!firstInvalidEventError) {
          firstInvalidEventError = toErrorMessage(error);
          firstInvalidEventMessage = formatInvalidStreamEventMessage(threadId, event, error);
          logger.warn(firstInvalidEventMessage);
          writeInvalidStreamEventDetail({
            threadId,
            error: firstInvalidEventError,
            ...(error instanceof ProtocolValidationError ? { issues: error.issues } : {}),
            frame: describeFrame(event),
            loggedAt: new Date().toISOString()
          });
        }
      }
    }

    if (invalidEventCount > 0) {
      logger.warn(
        `[stream-mismatch-summary] thread=${threadId} pruned=${String(invalidEventCount)} total=${String(rawEvents.length)}${firstInvalidEventMessage ? ` first="${firstInvalidEventMessage}"` : ""}`
      );
      this.streamEventsByThreadId.set(threadId, validRawEvents);
    }

    if (events.length === 0) {
      return {
        ownerClientId,
        conversationState: snapshotState,
        liveStateError: null
      };
    }

    try {
      const reductionInput = snapshotState
        ? [buildSyntheticSnapshotEvent(threadId, ownerClientId ?? "farfield", snapshotState), ...events]
        : events;
      const reduced = reduceThreadStreamEvents(reductionInput);
      const state = reduced.get(threadId);
      return {
        ownerClientId: state?.ownerClientId
          ?? ownerClientId
          ?? null,
        conversationState: state?.conversationState ?? snapshotState,
        liveStateError: null
      };
    } catch (error) {
      const details =
        error instanceof ThreadStreamReductionError
          ? {
              threadId: error.details.threadId,
              eventIndex: error.details.eventIndex,
              patchIndex: error.details.patchIndex
            }
          : null;
      logger.error(
        {
          threadId,
          eventCount: events.length,
          error: toErrorMessage(error),
          details
        },
        "codex-thread-stream-reduction-failed"
      );
      return {
        ownerClientId,
        conversationState: snapshotState,
        liveStateError: {
          kind: "reductionFailed",
          message: toErrorMessage(error),
          eventIndex: details?.eventIndex ?? null,
          patchIndex: details?.patchIndex ?? null
        }
      };
    }
  }

  public async readStreamEvents(threadId: string, limit: number): Promise<AgentThreadStreamEvents> {
    return {
      ownerClientId: this.threadOwnerById.get(threadId)
        ?? this.lastKnownOwnerClientId
        ?? null,
      events: (this.streamEventsByThreadId.get(threadId) ?? []).slice(-limit)
    };
  }

  public async replayRequest(
    method: string,
    params: IpcRequestFrame["params"],
    options: SendRequestOptions = {}
  ): Promise<IpcResponseFrame["result"]> {
    this.ensureIpcReady();
    const previewFrame: IpcFrame = {
      type: "request",
      requestId: "monitor-preview-request-id",
      method,
      params,
      targetClientId: options.targetClientId,
      version: options.version
    };
    this.emitIpcFrame({
      direction: "out",
      frame: previewFrame,
      method,
      threadId: extractThreadId(previewFrame)
    });

    const response = await this.ipcClient.sendRequestAndWait(method, params, options);
    return response.result;
  }

  public replayBroadcast(
    method: string,
    params: IpcRequestFrame["params"],
    options: SendRequestOptions = {}
  ): void {
    this.ensureIpcReady();
    const previewFrame: IpcFrame = {
      type: "broadcast",
      method,
      params,
      targetClientId: options.targetClientId,
      version: options.version
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
        version: options.version
      })
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
    const isSameState = this.runtimeState.appReady === next.appReady
      && this.runtimeState.ipcConnected === next.ipcConnected
      && this.runtimeState.ipcInitialized === next.ipcInitialized
      && this.runtimeState.codexAvailable === next.codexAvailable
      && this.runtimeState.lastError === next.lastError;

    if (isSameState) {
      return;
    }

    this.runtimeState = next;
    this.notifyStateChanged();
  }

  private patchRuntimeState(patch: Partial<CodexAgentRuntimeState>): void {
    this.setRuntimeState({
      ...this.runtimeState,
      ...patch
    });
  }

  private ensureCodexAvailable(): void {
    if (!this.runtimeState.codexAvailable) {
      throw new Error("Codex backend is not available");
    }
  }

  private ensureIpcReady(): void {
    if (!this.isIpcReady()) {
      throw new Error(this.runtimeState.lastError ?? "Desktop IPC is not connected");
    }
  }

  private scheduleIpcReconnect(): void {
    if (this.reconnectTimer || !this.runtimeState.codexAvailable || !this.started) {
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
        lastError: null
      });
      return result;
    } catch (error) {
      this.patchRuntimeState({
        appReady: !(error instanceof AppServerTransportError),
        lastError: toErrorMessage(error)
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
          this.appClient.listThreads({ limit: 1, archived: false })
        );
      } catch (error) {
        const message = toErrorMessage(error);
        const isSpawnError = message.includes("ENOENT") ||
          message.includes("not found") ||
          (error instanceof Error && "code" in error &&
            (error as NodeJS.ErrnoException).code === "ENOENT");

        if (isSpawnError) {
          this.patchRuntimeState({
            codexAvailable: false,
            lastError: message
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
          ipcConnected: true
        });

        await this.ipcClient.initialize(this.label);
        this.patchRuntimeState({
          ipcInitialized: true
        });
      } catch (error) {
        this.patchRuntimeState({
          ipcInitialized: false,
          ipcConnected: this.ipcClient.isConnected(),
          lastError: toErrorMessage(error)
        });
        this.scheduleIpcReconnect();
      } finally {
        this.bootstrapInFlight = null;
      }
    })();

    return this.bootstrapInFlight;
  }

  private async getActiveTurnId(threadId: string): Promise<string | null> {
    const readResult = await this.appClient.readThread(threadId, true);
    const turns = readResult.thread.turns;

    for (let index = turns.length - 1; index >= 0; index -= 1) {
      const turn = turns[index];
      if (!turn) {
        continue;
      }

      const status = turn.status.trim().toLowerCase();
      const isTerminal = status === "completed"
        || status === "failed"
        || status === "error"
        || status === "cancelled"
        || status === "canceled";
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

  private resolveThreadTitle(
    threadId: string,
    directTitle: string | null | undefined
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

  private setThreadTitle(threadId: string, title: string | null | undefined): void {
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

function normalizeStderrLine(line: string): string {
  return line.replace(ANSI_ESCAPE_REGEX, "").trim();
}

function describeFrame(frame: IpcFrame): string {
  if (frame.type === "broadcast" || frame.type === "request") {
    return `${frame.type}:${frame.method}`;
  }
  if (frame.type === "response") {
    return `response:${frame.method ?? "unknown"}`;
  }
  return frame.type;
}

function formatInvalidStreamEventMessage(
  threadId: string,
  event: IpcFrame,
  error: unknown
): string {
  const frame = describeFrame(event);
  if (error instanceof ProtocolValidationError) {
    return `[stream-mismatch] thread=${threadId} frame=${frame} issues=${formatIssueList(error.issues)}`;
  }
  return `[stream-mismatch] thread=${threadId} frame=${frame} error=${toErrorMessage(error)}`;
}

function formatIssueList(issues: string[]): string {
  if (issues.length === 0) {
    return "unknown";
  }
  const maxIssues = 4;
  const visible = issues.slice(0, maxIssues).join(" | ");
  if (issues.length <= maxIssues) {
    return visible;
  }
  return `${visible} | +${String(issues.length - maxIssues)} more`;
}

function parseIncomingThreadStreamBroadcast(frame: IpcFrame): ThreadStreamStateChangedBroadcast | null {
  try {
    return parseThreadStreamStateChangedBroadcast(frame);
  } catch {
    return null;
  }
}

function buildSyntheticSnapshotEvent(
  threadId: string,
  sourceClientId: string,
  conversationState: ThreadConversationState
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
        conversationState
      },
      version: 0,
      type: "thread-stream-state-changed"
    }
  };
}

function isKnownBenignAppServerStderr(line: string): boolean {
  return (
    line.includes("codex_core::rollout::list") &&
    line.includes("state db missing rollout path for thread")
  );
}

function writeInvalidStreamEventDetail(detail: Record<string, unknown>): void {
  try {
    fs.appendFileSync(
      INVALID_STREAM_EVENTS_LOG_PATH,
      JSON.stringify(detail) + "\n",
      { encoding: "utf8" }
    );
  } catch (error) {
    logger.warn(
      {
        path: INVALID_STREAM_EVENTS_LOG_PATH,
        error: toErrorMessage(error)
      },
      "codex-invalid-thread-stream-event-detail-write-failed"
    );
  }
}

function extractThreadId(frame: IpcFrame): string | null {
  if (frame.type === "broadcast" && frame.method === "thread-stream-state-changed") {
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
    asRecord["turnId"]
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return null;
}

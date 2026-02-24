import fs from "node:fs";
import path from "node:path";
import {
  AppServerClient,
  AppServerRpcError,
  AppServerTransportError,
  CodexMonitorService,
  DesktopIpcClient,
  findLatestTurnParamsTemplate,
  reduceThreadStreamEvents,
  ThreadStreamReductionError,
  type SendRequestOptions
} from "@farfield/api";
import {
  parseThreadStreamStateChangedBroadcast,
  parseUserInputResponsePayload,
  ProtocolValidationError,
  type IpcFrame,
  type IpcRequestFrame,
  type IpcResponseFrame
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
    canReadStreamEvents: true,
    canReadRateLimits: true
  };

  private readonly appClient: AppServerClient;
  private readonly ipcClient: DesktopIpcClient;
  private readonly service: CodexMonitorService;
  private readonly onStateChange: (() => void) | null;
  private readonly reconnectDelayMs: number;

  private readonly threadOwnerById = new Map<string, string>();
  private readonly streamEventsByThreadId = new Map<string, IpcFrame[]>();
  private readonly ipcFrameListeners = new Set<(event: CodexIpcFrameEvent) => void>();

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

      if (frame.sourceClientId && frame.sourceClientId.trim()) {
        this.threadOwnerById.set(conversationId, frame.sourceClientId.trim());
      }

      const current = this.streamEventsByThreadId.get(conversationId) ?? [];
      current.push(frame);
      if (current.length > 400) {
        current.splice(0, current.length - 400);
      }
      this.streamEventsByThreadId.set(conversationId, current);
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

    return {
      data: result.data,
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
    return {
      thread: result.thread
    };
  }

  public async sendMessage(input: AgentSendMessageInput): Promise<void> {
    this.ensureCodexAvailable();
    if (input.isSteering === true) {
      throw new Error("Steering messages are not supported on this endpoint.");
    }

    if (this.isIpcReady()) {
      const mappedOwnerClientId = this.threadOwnerById.get(input.threadId);
      const overrideOwnerClientId = input.ownerClientId;
      const ownerClientId = mappedOwnerClientId && mappedOwnerClientId.trim()
        ? mappedOwnerClientId.trim()
        : overrideOwnerClientId && overrideOwnerClientId.trim()
          ? overrideOwnerClientId.trim()
          : null;

      if (ownerClientId) {
        const readResult = await this.runAppServerCall(() =>
          this.appClient.readThread(input.threadId, true)
        );

        let turnStartTemplate: ReturnType<typeof findLatestTurnParamsTemplate> | null = null;
        try {
          turnStartTemplate = findLatestTurnParamsTemplate(readResult.thread);
        } catch {
          turnStartTemplate = null;
        }

        await this.service.sendMessage({
          threadId: input.threadId,
          ownerClientId,
          text: input.text,
          ...(input.cwd ? { cwd: input.cwd } : {}),
          ...(typeof input.isSteering === "boolean" ? { isSteering: input.isSteering } : {}),
          turnStartTemplate
        });
        return;
      }
    }

    try {
      await this.runAppServerCall(() =>
        this.appClient.sendUserMessage(input.threadId, input.text)
      );
      return;
    } catch (error) {
      if (!this.isConversationNotFoundError(error)) {
        throw error;
      }
    }

    await this.runAppServerCall(() =>
      this.appClient.resumeThread(input.threadId, { persistExtendedHistory: true })
    );
    await this.runAppServerCall(() =>
      this.appClient.sendUserMessage(input.threadId, input.text)
    );
  }

  public async interrupt(input: AgentInterruptInput): Promise<void> {
    this.ensureCodexAvailable();
    this.ensureIpcReady();

    const ownerClientId = resolveOwnerClientId(
      this.threadOwnerById,
      input.threadId,
      input.ownerClientId
    );

    await this.service.interrupt({
      threadId: input.threadId,
      ownerClientId
    });
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
      input.ownerClientId
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
  ): Promise<{ ownerClientId: string; requestId: number }> {
    this.ensureCodexAvailable();
    this.ensureIpcReady();

    const ownerClientId = resolveOwnerClientId(
      this.threadOwnerById,
      input.threadId,
      input.ownerClientId
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
    const rawEvents = this.streamEventsByThreadId.get(threadId) ?? [];
    if (rawEvents.length === 0) {
      return {
        ownerClientId: this.threadOwnerById.get(threadId) ?? null,
        conversationState: null,
        liveStateError: null
      };
    }

    const events: ReturnType<typeof parseThreadStreamStateChangedBroadcast>[] = [];
    const validRawEvents: IpcFrame[] = [];
    let invalidEventCount = 0;
    let firstInvalidEventError: string | null = null;

    for (const event of rawEvents) {
      try {
        events.push(parseThreadStreamStateChangedBroadcast(event));
        validRawEvents.push(event);
      } catch (error) {
        invalidEventCount += 1;
        if (!firstInvalidEventError) {
          firstInvalidEventError = toErrorMessage(error);
          logger.warn(
            {
              threadId,
              error: firstInvalidEventError,
              ...(error instanceof ProtocolValidationError ? { issues: error.issues } : {}),
              rawPayload: event
            },
            "codex-invalid-thread-stream-event-detail"
          );
          writeInvalidStreamEventDetail({
            threadId,
            error: firstInvalidEventError,
            ...(error instanceof ProtocolValidationError ? { issues: error.issues } : {}),
            rawPayload: event,
            loggedAt: new Date().toISOString()
          });
        }
      }
    }

    if (invalidEventCount > 0) {
      logger.warn(
        {
          threadId,
          invalidEventCount,
          eventCount: rawEvents.length,
          error: firstInvalidEventError
        },
        "codex-invalid-thread-stream-events-pruned"
      );
      this.streamEventsByThreadId.set(threadId, validRawEvents);
    }

    if (events.length === 0) {
      return {
        ownerClientId: this.threadOwnerById.get(threadId) ?? null,
        conversationState: null,
        liveStateError: null
      };
    }

    try {
      const reduced = reduceThreadStreamEvents(events);
      const state = reduced.get(threadId);
      return {
        ownerClientId: state?.ownerClientId ?? this.threadOwnerById.get(threadId) ?? null,
        conversationState: state?.conversationState ?? null,
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
        ownerClientId: this.threadOwnerById.get(threadId) ?? null,
        conversationState: null,
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
      ownerClientId: this.threadOwnerById.get(threadId) ?? null,
      events: (this.streamEventsByThreadId.get(threadId) ?? []).slice(-limit)
    };
  }

  public async readRateLimits(): Promise<import("@farfield/protocol").AppServerGetAccountRateLimitsResponse> {
    return this.runAppServerCall(() => this.appClient.readAccountRateLimits());
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

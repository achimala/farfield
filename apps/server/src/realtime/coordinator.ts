import {
  UnifiedRealtimeClientMessageSchema,
  UnifiedRealtimeServerMessageSchema,
  type JsonValue,
  type UnifiedRealtimeCoreState,
  type UnifiedRealtimeServerMessage,
  type UnifiedRealtimeTab,
  type UnifiedRealtimeThreadState,
} from "@farfield/unified-surface";
import type { Server, Socket } from "socket.io";

export const REALTIME_CLIENT_EVENT = "unified-realtime-client-message";
export const REALTIME_SERVER_EVENT = "unified-realtime-server-message";

interface RealtimeClientContext {
  selectedThreadId: string | null;
  activeTab: UnifiedRealtimeTab;
}

interface RealtimeDebugState {
  traceStatus: UnifiedRealtimeCoreState["traceStatus"];
  history: UnifiedRealtimeCoreState["history"];
}

export interface RealtimeCoordinatorOptions {
  io: Server;
  buildCoreState: () => Promise<UnifiedRealtimeCoreState>;
  buildThreadState: (input: {
    threadId: string;
    includeStreamEvents: boolean;
  }) => Promise<UnifiedRealtimeThreadState | null>;
  buildDebugState: () => Promise<RealtimeDebugState>;
}

export class RealtimeCoordinator {
  private readonly io: Server;
  private readonly buildCoreState: RealtimeCoordinatorOptions["buildCoreState"];
  private readonly buildThreadState: RealtimeCoordinatorOptions["buildThreadState"];
  private readonly buildDebugState: RealtimeCoordinatorOptions["buildDebugState"];
  private readonly contextBySocketId = new Map<string, RealtimeClientContext>();
  private syncVersion = 0;
  private pendingCoreDelta = false;
  private pendingDebugDelta = false;
  private readonly pendingThreadIds = new Set<string>();
  private flushTimer: NodeJS.Timeout | null = null;

  public constructor(options: RealtimeCoordinatorOptions) {
    this.io = options.io;
    this.buildCoreState = options.buildCoreState;
    this.buildThreadState = options.buildThreadState;
    this.buildDebugState = options.buildDebugState;
  }

  public start(): void {
    this.io.on("connection", (socket) => {
      this.contextBySocketId.set(socket.id, {
        selectedThreadId: null,
        activeTab: "chat",
      });

      void this.sendSnapshot(socket);

      socket.on(REALTIME_CLIENT_EVENT, (payload: JsonValue) => {
        this.handleClientMessage(socket, payload);
      });

      socket.on("disconnect", () => {
        this.contextBySocketId.delete(socket.id);
      });
    });
  }

  public queueCoreDelta(): void {
    this.pendingCoreDelta = true;
    this.scheduleFlush();
  }

  public queueDebugDelta(): void {
    this.pendingDebugDelta = true;
    this.scheduleFlush();
  }

  public queueThreadDelta(threadId: string): void {
    if (!threadId.trim()) {
      return;
    }
    this.pendingThreadIds.add(threadId);
    this.scheduleFlush();
  }

  public broadcastSyncError(message: string, code?: string): void {
    const nextVersion = this.nextSyncVersion();
    this.broadcastMessage({
      kind: "syncError",
      syncVersion: nextVersion,
      message,
      ...(code ? { code } : {}),
    });
  }

  private handleClientMessage(socket: Socket, payload: JsonValue): void {
    const parsed = UnifiedRealtimeClientMessageSchema.safeParse(payload);
    if (!parsed.success) {
      this.emitSyncError(socket, "Invalid realtime client payload", "invalidPayload", {
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
      return;
    }

    const current = this.contextBySocketId.get(socket.id) ?? {
      selectedThreadId: null,
      activeTab: "chat" as const,
    };

    if (parsed.data.kind === "hello") {
      this.contextBySocketId.set(socket.id, {
        selectedThreadId: parsed.data.selectedThreadId,
        activeTab: parsed.data.activeTab,
      });
      void this.sendSnapshot(socket);
      return;
    }

    if (parsed.data.kind === "selectionChanged") {
      this.contextBySocketId.set(socket.id, {
        selectedThreadId: parsed.data.selectedThreadId,
        activeTab: current.activeTab,
      });
      if (parsed.data.selectedThreadId) {
        this.queueThreadDelta(parsed.data.selectedThreadId);
      }
      return;
    }

    if (parsed.data.kind === "activeTabChanged") {
      this.contextBySocketId.set(socket.id, {
        selectedThreadId: current.selectedThreadId,
        activeTab: parsed.data.activeTab,
      });
      if (parsed.data.activeTab === "debug") {
        this.queueDebugDelta();
        if (current.selectedThreadId) {
          this.queueThreadDelta(current.selectedThreadId);
        }
      }
      return;
    }

    if (parsed.data.kind === "requestSnapshot") {
      void this.sendSnapshot(socket);
    }
  }

  private async sendSnapshot(socket: Socket): Promise<void> {
    try {
      const coreState = await this.buildCoreState();
      const context = this.contextBySocketId.get(socket.id) ?? {
        selectedThreadId: null,
        activeTab: "chat" as const,
      };

      const selectedThread = context.selectedThreadId
        ? await this.buildThreadState({
            threadId: context.selectedThreadId,
            includeStreamEvents: context.activeTab === "debug",
          })
        : null;

      this.emitMessage(socket, {
        kind: "snapshot",
        syncVersion: this.nextSyncVersion(),
        core: coreState,
        selectedThread,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emitSyncError(socket, message, "snapshotFailed");
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimer) {
      return;
    }

    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flushPendingDeltas();
    }, 120);
    this.flushTimer.unref();
  }

  private async flushPendingDeltas(): Promise<void> {
    const shouldSendCore = this.pendingCoreDelta;
    const shouldSendDebug = this.pendingDebugDelta;
    const threadIds = Array.from(this.pendingThreadIds);

    this.pendingCoreDelta = false;
    this.pendingDebugDelta = false;
    this.pendingThreadIds.clear();

    if (!shouldSendCore && !shouldSendDebug && threadIds.length === 0) {
      return;
    }

    const sockets = this.io.sockets.sockets;
    if (sockets.size === 0) {
      return;
    }

    let coreState: UnifiedRealtimeCoreState | null = null;
    if (shouldSendCore) {
      try {
        coreState = await this.buildCoreState();
      } catch (error) {
        this.broadcastSyncError(
          error instanceof Error ? error.message : String(error),
          "coreDeltaFailed",
        );
      }
    }

    let debugState: RealtimeDebugState | null = null;
    if (shouldSendDebug) {
      try {
        debugState = await this.buildDebugState();
      } catch (error) {
        this.broadcastSyncError(
          error instanceof Error ? error.message : String(error),
          "debugDeltaFailed",
        );
      }
    }

    const threadStateCache = new Map<string, UnifiedRealtimeThreadState | null>();

    for (const [socketId, socket] of sockets.entries()) {
      const context = this.contextBySocketId.get(socketId) ?? {
        selectedThreadId: null,
        activeTab: "chat" as const,
      };

      if (coreState) {
        this.emitMessage(socket, {
          kind: "coreDelta",
          syncVersion: this.nextSyncVersion(),
          core: coreState,
        });
      }

      if (debugState && context.activeTab === "debug") {
        this.emitMessage(socket, {
          kind: "debugDelta",
          syncVersion: this.nextSyncVersion(),
          traceStatus: debugState.traceStatus,
          history: debugState.history,
        });
      }

      if (!context.selectedThreadId) {
        continue;
      }

      if (!threadIds.includes(context.selectedThreadId)) {
        continue;
      }

      const streamKey = context.activeTab === "debug" ? "withStream" : "withoutStream";
      const cacheKey = `${context.selectedThreadId}:${streamKey}`;
      if (!threadStateCache.has(cacheKey)) {
        threadStateCache.set(
          cacheKey,
          await this.buildThreadState({
            threadId: context.selectedThreadId,
            includeStreamEvents: context.activeTab === "debug",
          }),
        );
      }

      const state = threadStateCache.get(cacheKey) ?? null;
      if (!state) {
        continue;
      }

      this.emitMessage(socket, {
        kind: "threadDelta",
        syncVersion: this.nextSyncVersion(),
        thread: state,
      });
    }
  }

  private emitSyncError(
    socket: Socket,
    message: string,
    code?: string,
    details?: JsonValue,
  ): void {
    this.emitMessage(socket, {
      kind: "syncError",
      syncVersion: this.nextSyncVersion(),
      message,
      ...(code ? { code } : {}),
      ...(details !== undefined ? { details } : {}),
    });
  }

  private emitMessage(socket: Socket, message: UnifiedRealtimeServerMessage): void {
    const parsed = UnifiedRealtimeServerMessageSchema.parse(message);
    socket.emit(REALTIME_SERVER_EVENT, parsed);
  }

  private broadcastMessage(message: UnifiedRealtimeServerMessage): void {
    const parsed = UnifiedRealtimeServerMessageSchema.parse(message);
    this.io.emit(REALTIME_SERVER_EVENT, parsed);
  }

  private nextSyncVersion(): number {
    this.syncVersion += 1;
    return this.syncVersion;
  }
}

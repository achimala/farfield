import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  UNIFIED_FEATURE_IDS,
  UnifiedRealtimeCoreStateSchema,
  UnifiedRealtimeServerMessageSchema,
  UnifiedRealtimeThreadStateSchema,
  type UnifiedRealtimeCoreState,
  type UnifiedRealtimeServerMessage,
  type UnifiedRealtimeThreadState,
} from "@farfield/unified-surface";
import { Server as SocketServer } from "socket.io";
import { io as createSocketClient, type Socket } from "socket.io-client";
import {
  REALTIME_CLIENT_EVENT,
  REALTIME_SERVER_EVENT,
  RealtimeCoordinator,
} from "../src/realtime/coordinator.js";

function waitForEvent(client: Socket, event: "connect" | "disconnect") {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for socket event: ${event}`));
    }, 4_000);
    client.once(event, () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

function waitForServerMessage(
  client: Socket,
  predicate: (message: UnifiedRealtimeServerMessage) => boolean,
) {
  return new Promise<UnifiedRealtimeServerMessage>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Timed out waiting for realtime server message"));
    }, 4_000);
    const listener = (payload: object) => {
      const parsed = UnifiedRealtimeServerMessageSchema.safeParse(payload);
      if (!parsed.success) {
        clearTimeout(timeout);
        client.off(REALTIME_SERVER_EVENT, listener);
        reject(new Error("Received invalid realtime server message"));
        return;
      }
      if (!predicate(parsed.data)) {
        return;
      }
      clearTimeout(timeout);
      client.off(REALTIME_SERVER_EVENT, listener);
      resolve(parsed.data);
    };
    client.on(REALTIME_SERVER_EVENT, listener);
  });
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function buildAvailableFeatures(): Record<string, { status: "available" }> {
  const features: Record<string, { status: "available" }> = {};
  for (const featureId of UNIFIED_FEATURE_IDS) {
    features[featureId] = { status: "available" };
  }
  return features;
}

function buildCoreState(threadId = "thread-1"): UnifiedRealtimeCoreState {
  return UnifiedRealtimeCoreStateSchema.parse({
    health: {
      appReady: true,
      ipcConnected: true,
      ipcInitialized: true,
      gitCommit: "abc123",
      lastError: null,
      historyCount: 1,
      threadOwnerCount: 0,
    },
    agents: {
      agents: [
        {
          id: "codex",
          label: "Codex",
          enabled: true,
          connected: true,
          features: buildAvailableFeatures(),
          capabilities: {
            canListModels: true,
            canListCollaborationModes: true,
            canSetCollaborationMode: true,
            canSubmitUserInput: true,
            canReadLiveState: true,
            canReadStreamEvents: true,
            canListProjectDirectories: true,
          },
          projectDirectories: ["/tmp/project"],
        },
      ],
      defaultAgentId: "codex",
    },
    sidebar: {
      rows: [
        {
          id: threadId,
          provider: "codex",
          preview: "Realtime thread",
          title: "Realtime thread",
          createdAt: 1,
          updatedAt: 2,
          cwd: "/tmp/project",
          source: "codex",
        },
      ],
      errors: {
        codex: null,
        opencode: null,
      },
    },
    rateLimits: null,
    traceStatus: null,
    history: [],
  });
}

function buildThreadState(threadId: string): UnifiedRealtimeThreadState {
  return UnifiedRealtimeThreadStateSchema.parse({
    threadId,
    readThread: {
      id: threadId,
      provider: "codex",
      turns: [],
      requests: [],
      latestCollaborationMode: null,
      latestModel: "gpt-5.3-codex",
      latestReasoningEffort: "medium",
      cwd: "/tmp/project",
      source: "codex",
    },
    liveState: {
      ownerClientId: null,
      conversationState: null,
      liveStateError: null,
    },
    streamEvents: [],
  });
}

describe("RealtimeCoordinator", () => {
  const openClients: Socket[] = [];
  let httpServer: http.Server | null = null;
  let ioServer: SocketServer | null = null;

  afterEach(async () => {
    for (const client of openClients.splice(0)) {
      if (client.connected) {
        client.disconnect();
      }
    }

    if (ioServer) {
      await new Promise<void>((resolve) => {
        ioServer?.close(() => resolve());
      });
      ioServer = null;
    }

    if (httpServer) {
      await new Promise<void>((resolve) => {
        httpServer?.close(() => resolve());
      });
      httpServer = null;
    }
  });

  async function setupCoordinator() {
    httpServer = http.createServer();
    ioServer = new SocketServer(httpServer, {
      transports: ["websocket"],
    });

    await new Promise<void>((resolve) => {
      httpServer?.listen(0, "127.0.0.1", () => resolve());
    });

    const address = httpServer.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to resolve local server address");
    }
    const port = address.port;

    const coordinator = new RealtimeCoordinator({
      io: ioServer,
      buildCoreState: async () => buildCoreState(),
      buildThreadState: async ({ threadId }) => buildThreadState(threadId),
      buildDebugState: async () => ({
        traceStatus: null,
        history: [],
      }),
    });
    coordinator.start();

    const createClient = () => {
      const client = createSocketClient(`http://127.0.0.1:${port}`, {
        transports: ["websocket"],
        reconnection: false,
      });
      openClients.push(client);
      return client;
    };

    return {
      coordinator,
      createClient,
    };
  }

  it("sends snapshot on connection and after hello with selected thread", async () => {
    const { createClient } = await setupCoordinator();
    const client = createClient();

    const initialSnapshotPromise = waitForServerMessage(
      client,
      (message) => message.kind === "snapshot",
    );
    await waitForEvent(client, "connect");
    const initialSnapshot = await initialSnapshotPromise;
    expect(initialSnapshot.kind).toBe("snapshot");
    if (initialSnapshot.kind !== "snapshot") {
      return;
    }
    expect(initialSnapshot.selectedThread).toBeNull();

    const helloSnapshotPromise = waitForServerMessage(client, (message) => {
      return (
        message.kind === "snapshot" &&
        message.selectedThread?.threadId === "thread-1"
      );
    });
    client.emit(REALTIME_CLIENT_EVENT, {
      kind: "hello",
      selectedThreadId: "thread-1",
      activeTab: "chat",
    });
    const helloSnapshot = await helloSnapshotPromise;
    expect(helloSnapshot.kind).toBe("snapshot");
    if (helloSnapshot.kind !== "snapshot") {
      return;
    }
    expect(helloSnapshot.selectedThread?.threadId).toBe("thread-1");
    expect(helloSnapshot.syncVersion).toBeGreaterThan(initialSnapshot.syncVersion);
  });

  it("rejects invalid client payload with syncError", async () => {
    const { createClient } = await setupCoordinator();
    const client = createClient();

    const initialSnapshotPromise = waitForServerMessage(
      client,
      (message) => message.kind === "snapshot",
    );
    await waitForEvent(client, "connect");
    await initialSnapshotPromise;

    const syncErrorPromise = waitForServerMessage(
      client,
      (message) =>
        message.kind === "syncError" && message.code === "invalidPayload",
    );
    client.emit(REALTIME_CLIENT_EVENT, {
      kind: "not-a-valid-kind",
    });

    const syncError = await syncErrorPromise;
    expect(syncError.kind).toBe("syncError");
    if (syncError.kind !== "syncError") {
      return;
    }
    expect(syncError.code).toBe("invalidPayload");
    expect(syncError.message).toContain("Invalid realtime client payload");
  });

  it("coalesces burst thread updates into one delta per selected thread", async () => {
    const { coordinator, createClient } = await setupCoordinator();
    const client = createClient();
    const threadMessages: UnifiedRealtimeServerMessage[] = [];

    client.on(REALTIME_SERVER_EVENT, (payload: object) => {
      const parsed = UnifiedRealtimeServerMessageSchema.safeParse(payload);
      if (parsed.success && parsed.data.kind === "threadDelta") {
        threadMessages.push(parsed.data);
      }
    });

    const initialSnapshotPromise = waitForServerMessage(
      client,
      (message) => message.kind === "snapshot",
    );
    await waitForEvent(client, "connect");
    await initialSnapshotPromise;

    client.emit(REALTIME_CLIENT_EVENT, {
      kind: "selectionChanged",
      selectedThreadId: "thread-1",
    });
    await sleep(50);

    coordinator.queueThreadDelta("thread-1");
    coordinator.queueThreadDelta("thread-1");
    coordinator.queueThreadDelta("thread-1");
    coordinator.queueThreadDelta("thread-2");
    await sleep(300);

    expect(threadMessages).toHaveLength(1);
    expect(threadMessages[0]).toMatchObject({
      kind: "threadDelta",
      thread: {
        threadId: "thread-1",
      },
    });
  });

  it("sends a fresh snapshot with incremented version after reconnect", async () => {
    const { createClient } = await setupCoordinator();

    const firstClient = createClient();
    const firstSnapshotPromise = waitForServerMessage(
      firstClient,
      (message) => message.kind === "snapshot",
    );
    await waitForEvent(firstClient, "connect");
    const firstSnapshot = await firstSnapshotPromise;

    firstClient.disconnect();
    await sleep(50);

    const secondClient = createClient();
    const secondSnapshotPromise = waitForServerMessage(
      secondClient,
      (message) => message.kind === "snapshot",
    );
    await waitForEvent(secondClient, "connect");
    const secondSnapshot = await secondSnapshotPromise;

    expect(secondSnapshot.kind).toBe("snapshot");
    expect(secondSnapshot.syncVersion).toBeGreaterThan(firstSnapshot.syncVersion);
  });
});

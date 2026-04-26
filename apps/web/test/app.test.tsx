import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  UnifiedRealtimeClientMessageSchema,
  UnifiedRealtimeCoreStateSchema,
  UnifiedRealtimeServerMessageSchema,
  type UnifiedRealtimeClientMessage,
  type UnifiedRealtimeCoreState,
  type UnifiedRealtimeServerMessage,
  type UnifiedRealtimeThreadState,
  JsonValue,
  UnifiedFeatureAvailability,
  UnifiedFeatureId,
  UnifiedItem,
  UnifiedThread,
} from "@farfield/unified-surface";
import { App } from "../src/App";

type SocketPayload = JsonValue | UnifiedRealtimeServerMessage;
type SocketListener = (payload?: SocketPayload) => void;

class MockRealtimeSocket {
  private static instances: MockRealtimeSocket[] = [];
  private static clientMessages: UnifiedRealtimeClientMessage[] = [];
  private readonly listeners = new Map<string, SocketListener[]>();

  public static reset(): void {
    MockRealtimeSocket.instances = [];
    MockRealtimeSocket.clientMessages = [];
  }

  public static getClientMessages(): UnifiedRealtimeClientMessage[] {
    return [...MockRealtimeSocket.clientMessages];
  }

  public static emitServerMessage(payload: UnifiedRealtimeServerMessage): void {
    const parsed = UnifiedRealtimeServerMessageSchema.parse(payload);
    for (const instance of MockRealtimeSocket.instances) {
      instance.emitToListeners("unified-realtime-server-message", parsed);
    }
  }

  public constructor() {
    MockRealtimeSocket.instances.push(this);
  }

  public on(event: string, listener: SocketListener): this {
    const current = this.listeners.get(event) ?? [];
    current.push(listener);
    this.listeners.set(event, current);
    return this;
  }

  public emit(_event: string, _payload?: JsonValue): boolean {
    if (_event === "unified-realtime-client-message") {
      const parsed = UnifiedRealtimeClientMessageSchema.parse(_payload);
      MockRealtimeSocket.clientMessages.push(parsed);
    }
    return true;
  }

  public connect(): void {
    this.emitToListeners("connect");
  }

  public disconnect(): void {
    this.emitToListeners("disconnect");
  }

  private emitToListeners(event: string, payload?: SocketPayload): void {
    const listeners = this.listeners.get(event) ?? [];
    for (const listener of listeners) {
      listener(payload);
    }
  }
}

vi.mock("socket.io-client", () => {
  return {
    io: vi.fn(() => new MockRealtimeSocket()),
  };
});

Element.prototype.scrollTo = vi.fn();
window.scrollTo = vi.fn();
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

vi.stubGlobal(
  "matchMedia",
  vi.fn((query: string) => ({
    matches: query === "(prefers-color-scheme: dark)",
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
);

const localStorageBacking = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: vi.fn((key: string): string | null => {
    return localStorageBacking.get(key) ?? null;
  }),
  setItem: vi.fn((key: string, value: string): void => {
    localStorageBacking.set(key, value);
  }),
  removeItem: vi.fn((key: string): void => {
    localStorageBacking.delete(key);
  }),
  clear: vi.fn((): void => {
    localStorageBacking.clear();
  }),
  key: vi.fn((index: number): string | null => {
    const keys = [...localStorageBacking.keys()];
    return keys[index] ?? null;
  }),
  get length(): number {
    return localStorageBacking.size;
  },
});

const FEATURE_IDS: UnifiedFeatureId[] = [
  "listThreads",
  "createThread",
  "readThread",
  "sendMessage",
  "interrupt",
  "listModels",
  "listCollaborationModes",
  "setCollaborationMode",
  "submitUserInput",
  "readLiveState",
  "readStreamEvents",
  "listProjectDirectories",
];

type ProviderId = "codex" | "opencode";

type CapabilityFixture = {
  canListModels: boolean;
  canListCollaborationModes: boolean;
  canSetCollaborationMode: boolean;
  canSubmitUserInput: boolean;
  canReadLiveState: boolean;
  canReadStreamEvents: boolean;
  canListProjectDirectories: boolean;
};

type FeatureSet = Record<UnifiedFeatureId, UnifiedFeatureAvailability>;

const codexCapabilities: CapabilityFixture = {
  canListModels: true,
  canListCollaborationModes: true,
  canSetCollaborationMode: true,
  canSubmitUserInput: true,
  canReadLiveState: true,
  canReadStreamEvents: true,
  canListProjectDirectories: true,
};

const opencodeCapabilities: CapabilityFixture = {
  canListModels: false,
  canListCollaborationModes: false,
  canSetCollaborationMode: false,
  canSubmitUserInput: false,
  canReadLiveState: false,
  canReadStreamEvents: false,
  canListProjectDirectories: true,
};

function buildFeatureSet(
  capabilities: CapabilityFixture,
  options?: { enabled?: boolean; connected?: boolean },
): FeatureSet {
  const enabled = options?.enabled ?? true;
  const connected = options?.connected ?? true;

  const unavailableReason: UnifiedFeatureAvailability = {
    status: "unavailable",
    reason: enabled ? "providerDisconnected" : "providerDisabled",
  };

  const available: UnifiedFeatureAvailability = {
    status: "available",
  };

  const features: FeatureSet = {
    listThreads: enabled && connected ? available : unavailableReason,
    createThread: enabled && connected ? available : unavailableReason,
    readThread: enabled && connected ? available : unavailableReason,
    sendMessage: enabled && connected ? available : unavailableReason,
    interrupt: enabled && connected ? available : unavailableReason,
    listModels:
      enabled && connected && capabilities.canListModels
        ? available
        : {
            status: "unavailable",
            reason:
              enabled && connected
                ? "unsupportedByProvider"
                : unavailableReason.reason,
          },
    listCollaborationModes:
      enabled && connected && capabilities.canListCollaborationModes
        ? available
        : {
            status: "unavailable",
            reason:
              enabled && connected
                ? "unsupportedByProvider"
                : unavailableReason.reason,
          },
    setCollaborationMode:
      enabled && connected && capabilities.canSetCollaborationMode
        ? available
        : {
            status: "unavailable",
            reason:
              enabled && connected
                ? "unsupportedByProvider"
                : unavailableReason.reason,
          },
    submitUserInput:
      enabled && connected && capabilities.canSubmitUserInput
        ? available
        : {
            status: "unavailable",
            reason:
              enabled && connected
                ? "unsupportedByProvider"
                : unavailableReason.reason,
          },
    readLiveState:
      enabled && connected && capabilities.canReadLiveState
        ? available
        : {
            status: "unavailable",
            reason:
              enabled && connected
                ? "unsupportedByProvider"
                : unavailableReason.reason,
          },
    readStreamEvents:
      enabled && connected && capabilities.canReadStreamEvents
        ? available
        : {
            status: "unavailable",
            reason:
              enabled && connected
                ? "unsupportedByProvider"
                : unavailableReason.reason,
          },
    listProjectDirectories:
      enabled && connected && capabilities.canListProjectDirectories
        ? available
        : {
            status: "unavailable",
            reason:
              enabled && connected
                ? "unsupportedByProvider"
                : unavailableReason.reason,
          },
  };

  return features;
}

type ThreadSummary = {
  id: string;
  provider: ProviderId;
  preview: string;
  title?: string | null;
  isGenerating?: boolean;
  waitingOnApproval?: boolean;
  waitingOnUserInput?: boolean;
  createdAt: number;
  updatedAt: number;
  cwd?: string;
  source?: string;
};

type UnifiedThreadFixture = UnifiedThread;

let featureMatrixFixture: {
  ok: true;
  features: Record<ProviderId, FeatureSet>;
};

let projectDirectoriesFixture: Record<ProviderId, string[]>;

let threadsFixture: {
  ok: true;
  data: ThreadSummary[];
  cursors: {
    codex: string | null;
    opencode: string | null;
  };
  errors: {
    codex: null;
    opencode: null;
  };
};

let collaborationModesFixture: Record<
  ProviderId,
  Array<{
    name: string;
    mode: string;
    model: string | null;
    reasoningEffort: string | null;
    developerInstructions: string | null;
  }>
>;

let modelsFixture: Record<
  ProviderId,
  Array<{
    id: string;
    displayName: string;
    description: string;
    defaultReasoningEffort: string | null;
    supportedReasoningEfforts: string[];
    hidden: boolean;
    isDefault: boolean;
  }>
>;

let readThreadResolver: (
  threadId: string,
  provider: ProviderId | null,
) => {
  ok: true;
  thread: UnifiedThreadFixture;
} | null;

let liveStateResolver: (
  threadId: string,
  provider: ProviderId,
) => {
  kind: "readLiveState";
  threadId: string;
  ownerClientId: string | null;
  conversationState: UnifiedThreadFixture | null;
  liveStateError: {
    kind: "reductionFailed";
    message: string;
    eventIndex: number | null;
    patchIndex: number | null;
  } | null;
};

function buildConversationStateFixture(
  threadId: string,
  modelId: string,
  options?: {
    updatedAt?: number;
    includePendingRequest?: boolean;
    customRequests?: UnifiedThreadFixture["requests"];
    provider?: ProviderId;
    latestReasoningEffort?: string | null;
    collaborationModeReasoningEffort?: string | null;
    turnItems?: UnifiedItem[];
  },
): UnifiedThreadFixture {
  const includePendingRequest = options?.includePendingRequest ?? false;
  const updatedAt = options?.updatedAt ?? 1700000000;
  const provider = options?.provider ?? "codex";
  const latestReasoningEffort =
    options?.latestReasoningEffort !== undefined
      ? options.latestReasoningEffort
      : "medium";
  const collaborationModeReasoningEffort =
    options?.collaborationModeReasoningEffort !== undefined
      ? options.collaborationModeReasoningEffort
      : "medium";
  return {
    id: threadId,
    provider,
    turns: [
      {
        id: "turn-1",
        status: "completed",
        items: options?.turnItems ?? [],
      },
    ],
    requests:
      options?.customRequests ??
      (includePendingRequest
        ? [
            {
              id: "request-1",
              method: "item/tool/requestUserInput",
              params: {
                threadId,
                turnId: "turn-1",
                itemId: "item-1",
                questions: [
                  {
                    id: "question-1",
                    header: "Question",
                    question: "Pick one option",
                    isOther: false,
                    isSecret: false,
                    options: [
                      { label: "Option A", description: "Use option A" },
                      { label: "Option B", description: "Use option B" },
                    ],
                  },
                ],
              },
            },
          ]
        : []),
    updatedAt,
    latestModel: modelId,
    latestReasoningEffort,
    latestCollaborationMode: {
      mode: "default",
      settings: {
        model: modelId,
        reasoningEffort: collaborationModeReasoningEffort,
        developerInstructions: null,
      },
    },
  };
}

function buildRealtimeFeatureSet(): Record<string, { status: "available" }> {
  const features: Record<string, { status: "available" }> = {};
  for (const featureId of FEATURE_IDS) {
    features[featureId] = { status: "available" };
  }
  return features;
}

function buildRealtimeCoreStateFixture(
  rows: UnifiedRealtimeCoreState["sidebar"]["rows"],
): UnifiedRealtimeCoreState {
  return UnifiedRealtimeCoreStateSchema.parse({
    health: {
      appReady: true,
      ipcConnected: true,
      ipcInitialized: true,
      gitCommit: "abc123",
      lastError: null,
      historyCount: 0,
      threadOwnerCount: 0,
    },
    agents: {
      agents: [
        {
          id: "codex",
          label: "Codex",
          enabled: true,
          connected: true,
          features: buildRealtimeFeatureSet(),
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
      rows,
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

function buildRealtimeThreadStateFixture(
  threadId: string,
  modelId: string,
): UnifiedRealtimeThreadState {
  return {
    threadId,
    readThread: buildConversationStateFixture(threadId, modelId),
    liveState: {
      ownerClientId: "client-1",
      conversationState: buildConversationStateFixture(threadId, modelId),
      liveStateError: null,
    },
    streamEvents: [],
  };
}

function jsonResponse(
  payload: Record<
    string,
    object | string | number | boolean | null | undefined
  >,
): Response {
  return {
    ok: true,
    json: async () => payload,
  } as Response;
}

function jsonErrorResponse(
  payload: Record<
    string,
    object | string | number | boolean | null | undefined
  >,
): Response {
  return {
    ok: false,
    json: async () => payload,
  } as Response;
}

beforeEach(() => {
  MockRealtimeSocket.reset();
  window.history.replaceState(null, "", "/");
  localStorageBacking.clear();

  featureMatrixFixture = {
    ok: true,
    features: {
      codex: buildFeatureSet(codexCapabilities, {
        enabled: true,
        connected: true,
      }),
      opencode: buildFeatureSet(opencodeCapabilities, {
        enabled: false,
        connected: false,
      }),
    },
  };

  projectDirectoriesFixture = {
    codex: ["/tmp/project"],
    opencode: [],
  };

  threadsFixture = {
    ok: true,
    data: [],
    cursors: {
      codex: null,
      opencode: null,
    },
    errors: {
      codex: null,
      opencode: null,
    },
  };

  collaborationModesFixture = {
    codex: [
      {
        name: "Default",
        mode: "default",
        model: null,
        reasoningEffort: "medium",
        developerInstructions: null,
      },
      {
        name: "Plan",
        mode: "plan",
        model: null,
        reasoningEffort: "medium",
        developerInstructions: "x",
      },
    ],
    opencode: [],
  };

  modelsFixture = {
    codex: [
      {
        id: "gpt-5.3-codex",
        displayName: "gpt-5.3-codex",
        description: "Test model",
        defaultReasoningEffort: "medium",
        supportedReasoningEfforts: ["medium"],
        hidden: false,
        isDefault: true,
      },
    ],
    opencode: [],
  };

  readThreadResolver = (_threadId: string, _provider: ProviderId | null) =>
    null;
  liveStateResolver = (threadId: string, _provider: ProviderId) => ({
    kind: "readLiveState",
    threadId,
    ownerClientId: null,
    conversationState: null,
    liveStateError: null,
  });
});

afterEach(() => {
  cleanup();
});

vi.stubGlobal(
  "fetch",
  vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const parsedUrl = new URL(url, "http://localhost");
    const pathname = parsedUrl.pathname;

    if (pathname === "/api/health") {
      return jsonResponse({
        ok: true,
        state: {
          appReady: true,
          ipcConnected: true,
          ipcInitialized: true,
          lastError: null,
          historyCount: 0,
          threadOwnerCount: 0,
        },
      });
    }

    if (pathname === "/api/unified/features") {
      return jsonResponse(featureMatrixFixture);
    }

    if (pathname === "/api/unified/threads") {
      return jsonResponse(threadsFixture);
    }

    if (pathname === "/api/unified/sidebar") {
      return jsonResponse({
        ok: true,
        rows: threadsFixture.data,
        errors: threadsFixture.errors,
      });
    }

    if (pathname.startsWith("/api/unified/thread/")) {
      const segments = pathname
        .split("/")
        .filter((segment) => segment.length > 0);
      const threadId = segments[3] ? decodeURIComponent(segments[3]) : "";
      const providerParam = parsedUrl.searchParams.get("provider");
      const provider =
        providerParam === "opencode" || providerParam === "codex"
          ? providerParam
          : null;
      const readThread = readThreadResolver(threadId, provider);
      if (readThread) {
        return jsonResponse(readThread);
      }
      return jsonErrorResponse({
        ok: false,
        error: {
          code: "threadNotFound",
          message: `Thread ${threadId} is not registered`,
        },
      });
    }

    if (pathname === "/api/unified/command") {
      const body = init?.body
        ? (JSON.parse(String(init.body)) as {
            kind: string;
            provider: ProviderId;
            threadId?: string;
          })
        : { kind: "unknown", provider: "codex" as const };

      if (body.kind === "listProjectDirectories") {
        return jsonResponse({
          ok: true,
          result: {
            kind: "listProjectDirectories",
            directories: projectDirectoriesFixture[body.provider],
          },
        });
      }

      if (body.kind === "listCollaborationModes") {
        return jsonResponse({
          ok: true,
          result: {
            kind: "listCollaborationModes",
            data: collaborationModesFixture[body.provider],
          },
        });
      }

      if (body.kind === "listModels") {
        return jsonResponse({
          ok: true,
          result: {
            kind: "listModels",
            data: modelsFixture[body.provider],
          },
        });
      }

      if (body.kind === "readLiveState") {
        return jsonResponse({
          ok: true,
          result: liveStateResolver(body.threadId ?? "", body.provider),
        });
      }

      if (body.kind === "readStreamEvents") {
        return jsonResponse({
          ok: true,
          result: {
            kind: "readStreamEvents",
            threadId: body.threadId ?? "",
            ownerClientId: null,
            events: [],
          },
        });
      }

      return jsonResponse({
        ok: true,
        result: {
          kind: body.kind,
        },
      });
    }

    if (pathname === "/api/debug/trace/status") {
      return jsonResponse({
        ok: true,
        active: null,
        recent: [],
      });
    }

    if (pathname === "/api/debug/history") {
      return jsonResponse({
        ok: true,
        history: [],
      });
    }

    return jsonResponse({ ok: true });
  }),
);

describe("App", () => {
  it("renders core sections", async () => {
    render(<App />);
    expect((await screen.findAllByText("Farfield")).length).toBeGreaterThan(0);
    expect(await screen.findByText("No thread selected")).toBeTruthy();
  });

  it("connects via websocket and sends hello", async () => {
    render(<App />);
    await waitFor(() => {
      expect(
        MockRealtimeSocket.getClientMessages().some(
          (message) => message.kind === "hello",
        ),
      ).toBe(true);
    });
  });

  it("applies websocket snapshot state", async () => {
    const threadId = "ws-snapshot-thread";
    threadsFixture = {
      ok: true,
      data: [
        {
          id: threadId,
          provider: "codex",
          preview: "Before snapshot preview",
          title: null,
          createdAt: 1700000000,
          updatedAt: 1700000000,
          cwd: "/tmp/project",
          source: "codex",
        },
      ],
      cursors: {
        codex: null,
        opencode: null,
      },
      errors: {
        codex: null,
        opencode: null,
      },
    };
    render(<App />);
    expect((await screen.findAllByText("Before snapshot preview")).length).toBeGreaterThan(0);
    await waitFor(() => {
      expect(
        MockRealtimeSocket.getClientMessages().some(
          (message) => message.kind === "hello",
        ),
      ).toBe(true);
    });

    MockRealtimeSocket.emitServerMessage({
      kind: "snapshot",
      syncVersion: 1,
      core: buildRealtimeCoreStateFixture([
        {
          id: threadId,
          provider: "codex",
          preview: "Snapshot thread preview",
          title: null,
          createdAt: 1700000000,
          updatedAt: 1700000001,
          cwd: "/tmp/project",
          source: "codex",
        },
      ]),
      selectedThread: null,
    });

    expect((await screen.findAllByText("Snapshot thread preview")).length).toBeGreaterThan(0);
  });

  it("applies websocket core deltas", async () => {
    const threadId = "ws-core-thread";
    threadsFixture = {
      ok: true,
      data: [
        {
          id: threadId,
          provider: "codex",
          preview: "Before core delta preview",
          title: null,
          createdAt: 1700000000,
          updatedAt: 1700000000,
          cwd: "/tmp/project",
          source: "codex",
        },
      ],
      cursors: {
        codex: null,
        opencode: null,
      },
      errors: {
        codex: null,
        opencode: null,
      },
    };
    render(<App />);
    expect((await screen.findAllByText("Before core delta preview")).length).toBeGreaterThan(0);
    await waitFor(() => {
      expect(
        MockRealtimeSocket.getClientMessages().some(
          (message) => message.kind === "hello",
        ),
      ).toBe(true);
    });

    MockRealtimeSocket.emitServerMessage({
      kind: "coreDelta",
      syncVersion: 2,
      core: buildRealtimeCoreStateFixture([
        {
          id: threadId,
          provider: "codex",
          preview: "Core delta preview",
          title: null,
          createdAt: 1700000000,
          updatedAt: 1700000002,
          cwd: "/tmp/project",
          source: "codex",
        },
      ]),
    });

    expect((await screen.findAllByText("Core delta preview")).length).toBeGreaterThan(0);
  });

  it("applies websocket debug deltas while debug tab is active", async () => {
    window.history.replaceState(null, "", "/debug");
    render(<App />);
    expect(await screen.findByText("History")).toBeTruthy();

    MockRealtimeSocket.emitServerMessage({
      kind: "debugDelta",
      syncVersion: 3,
      traceStatus: {
        active: {
          id: "trace-1",
          label: "Live trace",
          startedAt: "2026-03-01T00:00:00.000Z",
          stoppedAt: null,
          eventCount: 3,
          path: "/tmp/trace-1.ndjson",
        },
        recent: [],
      },
      history: [
        {
          id: "hist-1",
          at: "2026-03-01T00:00:00.000Z",
          source: "system",
          direction: "system",
          meta: {
            kind: "test",
          },
        },
      ],
    });

    expect(await screen.findByText("recording")).toBeTruthy();
    expect(await screen.findByText("1 entries")).toBeTruthy();
  });

  it("does not start polling intervals", async () => {
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    try {
      render(<App />);
      await waitFor(() => {
        expect(
          MockRealtimeSocket.getClientMessages().some(
            (message) => message.kind === "hello",
          ),
        ).toBe(true);
      });
      const pollingIntervalCalls = setIntervalSpy.mock.calls.filter((call) => {
        const delay = call[1];
        return typeof delay === "number" && delay >= 1_000;
      });
      expect(pollingIntervalCalls).toHaveLength(0);
    } finally {
      setIntervalSpy.mockRestore();
    }
  });

  it("shows waiting indicators in the sidebar from thread summaries", async () => {
    threadsFixture = {
      ok: true,
      data: [
        {
          id: "thread-waiting",
          provider: "codex",
          preview: "thread preview",
          createdAt: 1700000000,
          updatedAt: 1700000000,
          cwd: "/tmp/project",
          source: "codex",
          waitingOnApproval: true,
          waitingOnUserInput: true,
        },
      ],
      cursors: {
        codex: null,
        opencode: null,
      },
      errors: {
        codex: null,
        opencode: null,
      },
    };

    render(<App />);

    expect(await screen.findByTitle("Waiting for approval")).toBeTruthy();
    expect(await screen.findByTitle("Waiting for user input")).toBeTruthy();
  });

  it("shows waiting indicators in the sidebar for selected thread live requests", async () => {
    const threadId = "thread-live-waiting";
    const approvalRequest: UnifiedThreadFixture["requests"][number] = {
      id: "approval-live-1",
      method: "item/commandExecution/requestApproval",
      params: {
        threadId,
        turnId: "turn-1",
        itemId: "item-approval-live-1",
        reason: "Need approval",
      },
    };
    const userInputRequest: UnifiedThreadFixture["requests"][number] = {
      id: "request-user-input-live-1",
      method: "item/tool/requestUserInput",
      params: {
        threadId,
        turnId: "turn-1",
        itemId: "item-user-input-live-1",
        questions: [
          {
            id: "question-live-1",
            header: "Question",
            question: "Choose",
            isOther: false,
            isSecret: false,
            options: [
              { label: "A", description: "Pick A" },
              { label: "B", description: "Pick B" },
            ],
          },
        ],
      },
    };

    threadsFixture = {
      ok: true,
      data: [
        {
          id: threadId,
          provider: "codex",
          preview: "thread preview",
          createdAt: 1700000000,
          updatedAt: 1700000000,
          cwd: "/tmp/project",
          source: "codex",
        },
      ],
      cursors: {
        codex: null,
        opencode: null,
      },
      errors: {
        codex: null,
        opencode: null,
      },
    };

    readThreadResolver = (targetThreadId: string) => ({
      ok: true,
      thread: buildConversationStateFixture(targetThreadId, "gpt-old-codex", {
        customRequests: [approvalRequest, userInputRequest],
      }),
    });

    liveStateResolver = (targetThreadId: string, _provider: ProviderId) => ({
      kind: "readLiveState",
      threadId: targetThreadId,
      ownerClientId: "client-1",
      conversationState: buildConversationStateFixture(
        targetThreadId,
        "gpt-old-codex",
        {
          customRequests: [approvalRequest, userInputRequest],
        },
      ),
      liveStateError: null,
    });

    render(<App />);

    expect(await screen.findByTitle("Waiting for approval")).toBeTruthy();
    expect(await screen.findByTitle("Waiting for user input")).toBeTruthy();
  });

  it("prefers live-state requests when read thread is newer but has no pending requests", async () => {
    const threadId = "thread-live-approval-preferred";
    const approvalRequest: UnifiedThreadFixture["requests"][number] = {
      id: "approval-live-priority-1",
      method: "item/commandExecution/requestApproval",
      params: {
        threadId,
        turnId: "turn-1",
        itemId: "item-approval-live-priority-1",
        reason: "Need approval from live state",
      },
    };

    threadsFixture = {
      ok: true,
      data: [
        {
          id: threadId,
          provider: "codex",
          preview: "thread preview",
          createdAt: 1700000000,
          updatedAt: 1700000002,
          cwd: "/tmp/project",
          source: "codex",
        },
      ],
      cursors: {
        codex: null,
        opencode: null,
      },
      errors: {
        codex: null,
        opencode: null,
      },
    };

    readThreadResolver = (targetThreadId: string) => ({
      ok: true,
      thread: buildConversationStateFixture(targetThreadId, "gpt-old-codex", {
        updatedAt: 1700000002,
        customRequests: [],
      }),
    });

    liveStateResolver = (targetThreadId: string, _provider: ProviderId) => ({
      kind: "readLiveState",
      threadId: targetThreadId,
      ownerClientId: "client-1",
      conversationState: buildConversationStateFixture(
        targetThreadId,
        "gpt-old-codex",
        {
          updatedAt: 1700000001,
          customRequests: [approvalRequest],
        },
      ),
      liveStateError: null,
    });

    render(<App />);

    expect(await screen.findByText("Approval Needed")).toBeTruthy();
    expect(await screen.findByText("Need approval from live state")).toBeTruthy();
    expect(await screen.findByTitle("Waiting for approval")).toBeTruthy();
  });

  it("keeps a direct thread route selected when it is readable but not in current thread list page", async () => {
    const threadId = "thread-direct-route";
    window.history.replaceState(null, "", `/threads/${threadId}`);

    threadsFixture = {
      ok: true,
      data: [
        {
          id: "thread-listed",
          provider: "codex",
          preview: "listed thread",
          createdAt: 1700000000,
          updatedAt: 1700000001,
          cwd: "/tmp/project",
          source: "codex",
        },
      ],
      cursors: {
        codex: null,
        opencode: null,
      },
      errors: {
        codex: null,
        opencode: null,
      },
    };

    readThreadResolver = (
      targetThreadId: string,
      provider: ProviderId | null,
    ) => {
      if (targetThreadId === threadId) {
        return {
          ok: true,
          thread: buildConversationStateFixture(targetThreadId, "gpt-old-codex", {
            provider: provider ?? "codex",
            turnItems: [
              {
                id: "agent-hello-1",
                type: "agentMessage",
                text: "direct-route-loaded",
              },
            ],
          }),
        };
      }
      if (targetThreadId === "thread-listed") {
        return {
          ok: true,
          thread: buildConversationStateFixture(targetThreadId, "gpt-old-codex", {
            provider: provider ?? "codex",
            turnItems: [
              {
                id: "agent-listed-1",
                type: "agentMessage",
                text: "listed-thread-loaded",
              },
            ],
          }),
        };
      }
      return null;
    };

    render(<App />);

    expect(
      await screen.findByText("direct-route-loaded", undefined, {
        timeout: 3000,
      }),
    ).toBeTruthy();
    await waitFor(() =>
      expect(window.location.pathname).toBe(`/threads/${threadId}`),
    );
    expect(screen.queryByText("listed-thread-loaded")).toBeNull();
  });

  it("clears a transient direct-route registration error after the thread loads", async () => {
    const threadId = "thread-direct-route-transient";
    window.history.replaceState(null, "", `/threads/${threadId}`);

    threadsFixture = {
      ok: true,
      data: [],
      cursors: {
        codex: null,
        opencode: null,
      },
      errors: {
        codex: null,
        opencode: null,
      },
    };

    let readAttempts = 0;
    readThreadResolver = (
      targetThreadId: string,
      provider: ProviderId | null,
    ) => {
      if (targetThreadId !== threadId) {
        return null;
      }
      readAttempts += 1;
      if (readAttempts === 1) {
        return null;
      }
      return {
        ok: true,
        thread: buildConversationStateFixture(targetThreadId, "gpt-old-codex", {
          provider: provider ?? "codex",
          turnItems: [
            {
              id: "agent-transient-loaded-1",
              type: "agentMessage",
              text: "transient-route-loaded",
            },
          ],
        }),
      };
    };

    render(<App />);

    expect(
      await screen.findByText(`Thread ${threadId} is not registered`),
    ).toBeTruthy();
    expect(
      await screen.findByText("transient-route-loaded", {}, { timeout: 4000 }),
    ).toBeTruthy();
    await waitFor(() =>
      expect(
        screen.queryByText(`Thread ${threadId} is not registered`),
      ).toBeNull(),
    );
  });

  it("does not auto-switch to another listed thread when route thread is missing", async () => {
    const missingThreadId = "thread-missing-route";
    const listedThreadId = "thread-listed";
    window.history.replaceState(null, "", `/threads/${missingThreadId}`);

    threadsFixture = {
      ok: true,
      data: [
        {
          id: listedThreadId,
          provider: "codex",
          preview: "listed thread",
          createdAt: 1700000000,
          updatedAt: 1700000001,
          cwd: "/tmp/project",
          source: "codex",
        },
      ],
      cursors: {
        codex: null,
        opencode: null,
      },
      errors: {
        codex: null,
        opencode: null,
      },
    };

    readThreadResolver = (
      targetThreadId: string,
      provider: ProviderId | null,
    ) => {
      if (targetThreadId !== listedThreadId) {
        return null;
      }
      return {
        ok: true,
        thread: buildConversationStateFixture(
          listedThreadId,
          "gpt-old-codex",
          {
            provider: provider ?? "codex",
            turnItems: [
              {
                id: "agent-listed-1",
                type: "agentMessage",
                text: "listed-thread-loaded",
              },
            ],
          },
        ),
      };
    };

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "project" }));
    expect(await screen.findByText("listed thread")).toBeTruthy();
    await waitFor(() =>
      expect(window.location.pathname).toBe(`/threads/${missingThreadId}`),
    );
    expect(screen.queryByText("listed-thread-loaded")).toBeNull();
  });

  it("hides mode controls when capability is disabled", async () => {
    featureMatrixFixture = {
      ok: true,
      features: {
        codex: buildFeatureSet(codexCapabilities, {
          enabled: false,
          connected: false,
        }),
        opencode: buildFeatureSet(opencodeCapabilities, {
          enabled: true,
          connected: true,
        }),
      },
    };

    render(<App />);
    await screen.findAllByText("Farfield");
    expect(screen.queryByText("Plan")).toBeNull();
  });

  it("shows mode controls when capability is enabled", async () => {
    render(<App />);
    expect(await screen.findByText("Plan")).toBeTruthy();
  });

  it("sends an explicit collaboration mode model for web messages", async () => {
    const threadId = "thread-plan-send";
    const modelId = "gpt-5.3-codex";
    const threadState = {
      ...buildConversationStateFixture(threadId, modelId, {
        latestReasoningEffort: null,
        collaborationModeReasoningEffort: null,
      }),
      latestModel: null,
      latestCollaborationMode: {
        mode: "plan",
        settings: {
          model: null,
          reasoningEffort: null,
          developerInstructions: "plan instructions",
        },
      },
    } satisfies UnifiedThreadFixture;

    threadsFixture = {
      ok: true,
      data: [
        {
          id: threadId,
          provider: "codex",
          preview: "thread preview",
          createdAt: 1700000000,
          updatedAt: 1700000000,
          cwd: "/tmp/project",
          source: "codex",
        },
      ],
      cursors: {
        codex: null,
        opencode: null,
      },
      errors: {
        codex: null,
        opencode: null,
      },
    };

    collaborationModesFixture = {
      codex: [
        {
          name: "Default",
          mode: "default",
          model: null,
          reasoningEffort: "medium",
          developerInstructions: null,
        },
        {
          name: "Plan",
          mode: "plan",
          model: null,
          reasoningEffort: "high",
          developerInstructions: "plan instructions",
        },
      ],
      opencode: [],
    };

    modelsFixture = {
      codex: [
        {
          id: modelId,
          displayName: modelId,
          description: "Default model",
          defaultReasoningEffort: "medium",
          supportedReasoningEfforts: ["medium", "high"],
          hidden: false,
          isDefault: true,
        },
      ],
      opencode: [],
    };

    readThreadResolver = (targetThreadId: string) => ({
      ok: true,
      thread: {
        ...threadState,
        id: targetThreadId,
      },
    });

    liveStateResolver = (targetThreadId: string, _provider: ProviderId) => ({
      kind: "readLiveState",
      threadId: targetThreadId,
      ownerClientId: "client-1",
      conversationState: {
        ...threadState,
        id: targetThreadId,
      },
      liveStateError: null,
    });

    render(<App />);

    fireEvent.change(await screen.findByRole("textbox"), {
      target: { value: "Plan this change" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Send" }));

    type UnifiedCommandPayload = {
      kind?: string;
      ownerClientId?: string;
      text?: string;
      collaborationMode?: {
        mode?: string;
        settings?: {
          model?: string;
        };
      };
    };

    await waitFor(() => {
      const payloads = vi
        .mocked(fetch)
        .mock
        .calls
        .filter(([input]) => String(input).includes("/api/unified/command"))
        .map(([, init]) =>
          JSON.parse(String(init?.body ?? "{}")) as UnifiedCommandPayload,
        );

      const sendCommand =
        payloads.find(
          (payload) =>
            payload.kind === "sendMessage" &&
            payload.text === "Plan this change",
        ) ?? null;

      expect(sendCommand).not.toBeNull();
      expect(sendCommand?.ownerClientId).toBe("client-1");
      expect(sendCommand?.collaborationMode?.mode).toBe("plan");
      expect(sendCommand?.collaborationMode?.settings?.model).toBe(modelId);
    });
  });

  it("uses thread latest model when collaboration mode leaves model unset", async () => {
    const threadId = "thread-latest-model-fallback";
    const latestModelId = "gpt-5.3-codex";
    const defaultModelId = "gpt-5-mini";
    const baseThreadState = buildConversationStateFixture(
      threadId,
      latestModelId,
      {
        latestReasoningEffort: "high",
        collaborationModeReasoningEffort: null,
      },
    );
    const threadState = {
      ...baseThreadState,
      latestModel: latestModelId,
      latestCollaborationMode: baseThreadState.latestCollaborationMode
        ? {
            ...baseThreadState.latestCollaborationMode,
            settings: {
              ...baseThreadState.latestCollaborationMode.settings,
              model: null,
              reasoningEffort: null,
            },
          }
        : null,
    } satisfies UnifiedThreadFixture;

    threadsFixture = {
      ok: true,
      data: [
        {
          id: threadId,
          provider: "codex",
          preview: "thread preview",
          createdAt: 1700000000,
          updatedAt: 1700000000,
          cwd: "/tmp/project",
          source: "codex",
        },
      ],
      cursors: {
        codex: null,
        opencode: null,
      },
      errors: {
        codex: null,
        opencode: null,
      },
    };

    collaborationModesFixture = {
      codex: [
        {
          name: "Default",
          mode: "default",
          model: null,
          reasoningEffort: null,
          developerInstructions: null,
        },
      ],
      opencode: [],
    };

    modelsFixture = {
      codex: [
        {
          id: defaultModelId,
          displayName: defaultModelId,
          description: "Default model",
          defaultReasoningEffort: "medium",
          supportedReasoningEfforts: ["medium", "high"],
          hidden: false,
          isDefault: true,
        },
        {
          id: latestModelId,
          displayName: latestModelId,
          description: "Thread model",
          defaultReasoningEffort: "high",
          supportedReasoningEfforts: ["medium", "high"],
          hidden: false,
          isDefault: false,
        },
      ],
      opencode: [],
    };

    readThreadResolver = (targetThreadId: string) => ({
      ok: true,
      thread: {
        ...threadState,
        id: targetThreadId,
      },
    });

    liveStateResolver = (targetThreadId: string, _provider: ProviderId) => ({
      kind: "readLiveState",
      threadId: targetThreadId,
      ownerClientId: "client-1",
      conversationState: {
        ...threadState,
        id: targetThreadId,
      },
      liveStateError: null,
    });

    render(<App />);

    fireEvent.change(await screen.findByRole("textbox"), {
      target: { value: "Use the thread model" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Send" }));

    type UnifiedCommandPayload = {
      kind?: string;
      text?: string;
      model?: string;
      collaborationMode?: {
        settings?: {
          model?: string;
        };
      };
    };

    await waitFor(() => {
      const payloads = vi
        .mocked(fetch)
        .mock
        .calls
        .filter(([input]) => String(input).includes("/api/unified/command"))
        .map(([, init]) =>
          JSON.parse(String(init?.body ?? "{}")) as UnifiedCommandPayload,
        );

      const sendCommand =
        payloads.find(
          (payload) =>
            payload.kind === "sendMessage" &&
            payload.text === "Use the thread model",
        ) ?? null;

      expect(sendCommand).not.toBeNull();
      expect(sendCommand?.model).toBe(latestModelId);
      expect(sendCommand?.collaborationMode?.settings?.model).toBe(
        latestModelId,
      );
    });
  });

  it("shows project group labels from cwd basename", async () => {
    threadsFixture = {
      ok: true,
      data: [
        {
          id: "thread-site",
          provider: "codex",
          preview: "thread in renamed project",
          createdAt: 1700000000,
          updatedAt: 1700000001,
          cwd: "/tmp/site",
          source: "codex",
        },
      ],
      cursors: {
        codex: null,
        opencode: null,
      },
      errors: {
        codex: null,
        opencode: null,
      },
    };

    render(<App />);
    expect(await screen.findByRole("button", { name: "site" })).toBeTruthy();
  });

  it("keeps manual group order over automatic recency sort", async () => {
    localStorageBacking.set(
      "farfield.sidebar.order.v1",
      JSON.stringify(["project:/tmp/proj-b", "project:/tmp/proj-a"]),
    );

    threadsFixture = {
      ok: true,
      data: [
        {
          id: "thread-a",
          provider: "codex",
          preview: "alpha thread",
          createdAt: 1700000000,
          updatedAt: 1700000100,
          cwd: "/tmp/proj-a",
          source: "codex",
        },
        {
          id: "thread-b",
          provider: "codex",
          preview: "beta thread",
          createdAt: 1700000000,
          updatedAt: 1700000005,
          cwd: "/tmp/proj-b",
          source: "codex",
        },
      ],
      cursors: {
        codex: null,
        opencode: null,
      },
      errors: {
        codex: null,
        opencode: null,
      },
    };

    render(<App />);

    const projA = await screen.findByRole("button", { name: "proj-a" });
    const projB = await screen.findByRole("button", { name: "proj-b" });

    expect(
      projB.compareDocumentPosition(projA) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("shows thread title when provided", async () => {
    threadsFixture = {
      ok: true,
      data: [
        {
          id: "thread-title",
          provider: "codex",
          preview: "preview text",
          title: "Pretty Thread Name",
          createdAt: 1700000000,
          updatedAt: 1700000001,
          cwd: "/tmp/project",
          source: "codex",
        },
      ],
      cursors: {
        codex: null,
        opencode: null,
      },
      errors: {
        codex: null,
        opencode: null,
      },
    };

    render(<App />);
    const matches = await screen.findAllByText("Pretty Thread Name");
    expect(matches.length).toBeGreaterThan(0);
  });

  it("orders threads by recency and shows spinner for non-selected running thread", async () => {
    threadsFixture = {
      ok: true,
      data: [
        {
          id: "thread-old",
          provider: "codex",
          preview: "older thread",
          createdAt: 1700000000,
          updatedAt: 1700000001,
          isGenerating: true,
          cwd: "/tmp/project",
          source: "codex",
        },
        {
          id: "thread-new",
          provider: "codex",
          preview: "newer thread",
          createdAt: 1700000000,
          updatedAt: 1700000010,
          cwd: "/tmp/project",
          source: "codex",
        },
      ],
      cursors: {
        codex: null,
        opencode: null,
      },
      errors: {
        codex: null,
        opencode: null,
      },
    };

    render(<App />);

    const newer = (await screen.findAllByText("newer thread"))[0];
    const older = (await screen.findAllByText("older thread"))[0];
    if (!newer || !older) {
      throw new Error("Missing thread labels");
    }
    const newerButton = newer.closest("button");
    const olderButton = older.closest("button");

    expect(newerButton).toBeTruthy();
    expect(olderButton).toBeTruthy();
    if (!newerButton || !olderButton) {
      throw new Error("Missing thread buttons in sidebar");
    }
    expect(
      newerButton.compareDocumentPosition(olderButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(olderButton.querySelector("svg.animate-spin")).toBeTruthy();
  });

  it("updates the picker when remote model changes with same updatedAt and turns", async () => {
    const threadId = "thread-1";
    let modelId = "gpt-old-codex";
    let liveStateCallCount = 0;
    let readThreadCallCount = 0;
    let latestObservedModel = "";

    threadsFixture = {
      ok: true,
      data: [
        {
          id: threadId,
          provider: "codex",
          preview: "thread preview",
          createdAt: 1700000000,
          updatedAt: 1700000000,
          cwd: "/tmp/project",
          source: "codex",
        },
      ],
      cursors: {
        codex: null,
        opencode: null,
      },
      errors: {
        codex: null,
        opencode: null,
      },
    };

    modelsFixture = {
      codex: [
        {
          id: "gpt-old-codex",
          displayName: "gpt-old-codex",
          description: "Old model",
          defaultReasoningEffort: "medium",
          supportedReasoningEfforts: ["medium"],
          hidden: false,
          isDefault: false,
        },
        {
          id: "gpt-new-codex",
          displayName: "gpt-new-codex",
          description: "New model",
          defaultReasoningEffort: "medium",
          supportedReasoningEfforts: ["medium"],
          hidden: false,
          isDefault: true,
        },
      ],
      opencode: [],
    };

    readThreadResolver = (targetThreadId: string) => ({
      ok: true,
      thread: (() => {
        readThreadCallCount += 1;
        latestObservedModel = modelId;
        return buildConversationStateFixture(targetThreadId, modelId);
      })(),
    });

    liveStateResolver = (targetThreadId: string, _provider: ProviderId) => ({
      kind: "readLiveState",
      threadId: targetThreadId,
      ownerClientId: "client-1",
      conversationState: (() => {
        liveStateCallCount += 1;
        latestObservedModel = modelId;
        return buildConversationStateFixture(targetThreadId, modelId);
      })(),
      liveStateError: null,
    });

    render(<App />);
    await waitFor(() => {
      expect(liveStateCallCount + readThreadCallCount).toBeGreaterThan(0);
    });
    expect(latestObservedModel).toBe("gpt-old-codex");

    modelId = "gpt-new-codex";

    MockRealtimeSocket.emitServerMessage({
      kind: "threadDelta",
      syncVersion: 2,
      thread: buildRealtimeThreadStateFixture(threadId, modelId),
    });

    await waitFor(
      () => {
        expect(screen.getByText("gpt-new-codex")).toBeTruthy();
      },
      { timeout: 5000 },
    );
  }, 15000);

  it("uses live pending requests when live reduction fails", async () => {
    const threadId = "thread-with-request";

    threadsFixture = {
      ok: true,
      data: [
        {
          id: threadId,
          provider: "codex",
          preview: "thread preview",
          createdAt: 1700000000,
          updatedAt: 1700000000,
          cwd: "/tmp/project",
          source: "codex",
        },
      ],
      cursors: {
        codex: null,
        opencode: null,
      },
      errors: {
        codex: null,
        opencode: null,
      },
    };

    readThreadResolver = (targetThreadId: string) => ({
      ok: true,
      thread: buildConversationStateFixture(targetThreadId, "gpt-old-codex", {
        updatedAt: 1700000000,
        includePendingRequest: true,
      }),
    });

    liveStateResolver = (targetThreadId: string, _provider: ProviderId) => ({
      kind: "readLiveState",
      threadId: targetThreadId,
      ownerClientId: "client-1",
      conversationState: buildConversationStateFixture(
        targetThreadId,
        "gpt-old-codex",
        {
          updatedAt: 1700000500,
          includePendingRequest: false,
        },
      ),
      liveStateError: {
        kind: "reductionFailed",
        message: "failed to reduce",
        eventIndex: 2,
        patchIndex: 0,
      },
    });

    render(<App />);

    expect(
      await screen.findByText("Live updates failed for this thread."),
    ).toBeTruthy();
    expect(screen.queryByText("Pick one option")).toBeNull();
    expect(screen.queryByText("Option A")).toBeNull();
    expect(screen.queryByText("Option B")).toBeNull();
  });

  it("uses live thread requests when live and read timestamps match", async () => {
    const threadId = "thread-stale-live-request";
    const approvalRequest: UnifiedThreadFixture["requests"][number] = {
      id: "approval-stale-live-1",
      method: "item/commandExecution/requestApproval",
      params: {
        threadId,
        turnId: "turn-1",
        itemId: "item-approval-stale-live-1",
        reason: "stale request",
      },
    };

    threadsFixture = {
      ok: true,
      data: [
        {
          id: threadId,
          provider: "codex",
          preview: "thread preview",
          waitingOnApproval: false,
          waitingOnUserInput: false,
          createdAt: 1700000000,
          updatedAt: 1700000000,
          cwd: "/tmp/project",
          source: "codex",
        },
      ],
      cursors: {
        codex: null,
        opencode: null,
      },
      errors: {
        codex: null,
        opencode: null,
      },
    };

    readThreadResolver = (targetThreadId: string) => ({
      ok: true,
      thread: buildConversationStateFixture(targetThreadId, "gpt-old-codex", {
        updatedAt: 1700000000,
        customRequests: [],
      }),
    });

    liveStateResolver = (targetThreadId: string, _provider: ProviderId) => ({
      kind: "readLiveState",
      threadId: targetThreadId,
      ownerClientId: "client-1",
      conversationState: buildConversationStateFixture(
        targetThreadId,
        "gpt-old-codex",
        {
          updatedAt: 1700000000,
          customRequests: [approvalRequest],
        },
      ),
      liveStateError: null,
    });

    render(<App />);

    expect((await screen.findAllByText("thread preview")).length).toBeGreaterThan(0);
    expect(await screen.findByText("Approval Needed")).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Approve" })).toBeTruthy();
  });

  it("uses live thread requests when live and read timestamps match and sidebar is waiting", async () => {
    const threadId = "thread-live-request-while-waiting";
    const approvalRequest: UnifiedThreadFixture["requests"][number] = {
      id: "approval-live-while-waiting-1",
      method: "item/commandExecution/requestApproval",
      params: {
        threadId,
        turnId: "turn-1",
        itemId: "item-approval-live-while-waiting-1",
        reason: "needs approval",
      },
    };

    threadsFixture = {
      ok: true,
      data: [
        {
          id: threadId,
          provider: "codex",
          preview: "thread preview",
          waitingOnApproval: true,
          waitingOnUserInput: false,
          createdAt: 1700000000,
          updatedAt: 1700000000,
          cwd: "/tmp/project",
          source: "codex",
        },
      ],
      cursors: {
        codex: null,
        opencode: null,
      },
      errors: {
        codex: null,
        opencode: null,
      },
    };

    readThreadResolver = (targetThreadId: string) => ({
      ok: true,
      thread: buildConversationStateFixture(targetThreadId, "gpt-old-codex", {
        updatedAt: 1700000000,
        customRequests: [],
      }),
    });

    liveStateResolver = (targetThreadId: string, _provider: ProviderId) => ({
      kind: "readLiveState",
      threadId: targetThreadId,
      ownerClientId: "client-1",
      conversationState: buildConversationStateFixture(
        targetThreadId,
        "gpt-old-codex",
        {
          updatedAt: 1700000000,
          customRequests: [approvalRequest],
        },
      ),
      liveStateError: null,
    });

    render(<App />);

    expect(await screen.findByText("Approval Needed")).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Approve" })).toBeTruthy();
  });

  it("shows approval requests from thread state and submits approve decisions", async () => {
    const threadId = "thread-with-approval-request";
    const approvalRequest: UnifiedThreadFixture["requests"][number] = {
      id: "approval-1",
      method: "item/commandExecution/requestApproval",
      params: {
        threadId,
        turnId: "turn-1",
        itemId: "item-approval-1",
        reason: "Need elevated permission",
      },
    };

    threadsFixture = {
      ok: true,
      data: [
        {
          id: threadId,
          provider: "codex",
          preview: "thread preview",
          createdAt: 1700000000,
          updatedAt: 1700000000,
          cwd: "/tmp/project",
          source: "codex",
        },
      ],
      cursors: {
        codex: null,
        opencode: null,
      },
      errors: {
        codex: null,
        opencode: null,
      },
    };

    readThreadResolver = (targetThreadId: string) => ({
      ok: true,
      thread: buildConversationStateFixture(targetThreadId, "gpt-old-codex", {
        customRequests: [approvalRequest],
      }),
    });

    liveStateResolver = (targetThreadId: string, _provider: ProviderId) => ({
      kind: "readLiveState",
      threadId: targetThreadId,
      ownerClientId: "client-1",
      conversationState: buildConversationStateFixture(
        targetThreadId,
        "gpt-old-codex",
        {
          customRequests: [approvalRequest],
        },
      ),
      liveStateError: null,
    });

    render(<App />);

    expect(await screen.findByText("Approval Needed")).toBeTruthy();
    expect(
      await screen.findByText("item/commandExecution/requestApproval"),
    ).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Approve" })).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Deny" })).toBeTruthy();

    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));

    type UnifiedCommandPayload = {
      kind?: string;
      ownerClientId?: string;
      requestId?: string | number;
      response?: {
        decision?: JsonValue;
      };
    };

    await waitFor(() => {
      const payloads = vi
        .mocked(fetch)
        .mock
        .calls
        .filter(([input]) => String(input).includes("/api/unified/command"))
        .map(([, init]) =>
          JSON.parse(String(init?.body ?? "{}")) as UnifiedCommandPayload,
        );

      const submitCommand =
        payloads.find(
          (payload) =>
            payload.kind === "submitUserInput" &&
            payload.requestId === "approval-1",
        ) ?? null;

      expect(submitCommand).not.toBeNull();
      expect(submitCommand?.ownerClientId).toBe("client-1");
      expect(submitCommand?.response?.decision).toBe("accept");
    });
  });

  it("submits structured approval decisions from available decisions", async () => {
    const threadId = "thread-with-structured-approval";
    const approvalDecision = {
      acceptWithExecpolicyAmendment: {
        execpolicy_amendment: ["uv run"],
      },
    };
    const approvalRequest: UnifiedThreadFixture["requests"][number] = {
      id: "approval-structured-1",
      method: "item/commandExecution/requestApproval",
      params: {
        threadId,
        turnId: "turn-1",
        itemId: "item-approval-structured-1",
        reason: "Need policy approval",
        availableDecisions: [approvalDecision, "decline", "cancel"],
      },
    };

    threadsFixture = {
      ok: true,
      data: [
        {
          id: threadId,
          provider: "codex",
          preview: "thread preview",
          createdAt: 1700000000,
          updatedAt: 1700000000,
          cwd: "/tmp/project",
          source: "codex",
        },
      ],
      cursors: {
        codex: null,
        opencode: null,
      },
      errors: {
        codex: null,
        opencode: null,
      },
    };

    readThreadResolver = (targetThreadId: string) => ({
      ok: true,
      thread: buildConversationStateFixture(targetThreadId, "gpt-old-codex", {
        customRequests: [approvalRequest],
      }),
    });

    liveStateResolver = (targetThreadId: string, _provider: ProviderId) => ({
      kind: "readLiveState",
      threadId: targetThreadId,
      ownerClientId: "client-1",
      conversationState: buildConversationStateFixture(
        targetThreadId,
        "gpt-old-codex",
        {
          customRequests: [approvalRequest],
        },
      ),
      liveStateError: null,
    });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));

    type UnifiedCommandPayload = {
      kind?: string;
      ownerClientId?: string;
      requestId?: string | number;
      response?: {
        decision?: JsonValue;
      };
    };

    await waitFor(() => {
      const payloads = vi
        .mocked(fetch)
        .mock
        .calls
        .filter(([input]) => String(input).includes("/api/unified/command"))
        .map(([, init]) =>
          JSON.parse(String(init?.body ?? "{}")) as UnifiedCommandPayload,
        );

      const submitCommand =
        payloads.find(
          (payload) =>
            payload.kind === "submitUserInput" &&
            payload.requestId === "approval-structured-1",
        ) ?? null;

      expect(submitCommand).not.toBeNull();
      expect(submitCommand?.ownerClientId).toBe("client-1");
      expect(submitCommand?.response?.decision).toEqual(approvalDecision);
    });
  });

  it("uses live turn items when live reduction fails", async () => {
    const threadId = "thread-missing-commands";
    const commandItem: UnifiedItem = {
      id: "command-1",
      type: "commandExecution",
      command: "bun run test",
      status: "completed",
      aggregatedOutput: "ok",
      exitCode: 0,
      durationMs: 123,
    };

    threadsFixture = {
      ok: true,
      data: [
        {
          id: threadId,
          provider: "codex",
          preview: "thread preview",
          createdAt: 1700000000,
          updatedAt: 1700000500,
          cwd: "/tmp/project",
          source: "codex",
        },
      ],
      cursors: {
        codex: null,
        opencode: null,
      },
      errors: {
        codex: null,
        opencode: null,
      },
    };

    readThreadResolver = (targetThreadId: string) => ({
      ok: true,
      thread: buildConversationStateFixture(targetThreadId, "gpt-old-codex", {
        updatedAt: 1700000000,
        turnItems: [commandItem],
      }),
    });

    liveStateResolver = (targetThreadId: string, _provider: ProviderId) => ({
      kind: "readLiveState",
      threadId: targetThreadId,
      ownerClientId: "client-1",
      conversationState: buildConversationStateFixture(
        targetThreadId,
        "gpt-old-codex",
        {
          updatedAt: 1700000500,
          turnItems: [],
        },
      ),
      liveStateError: {
        kind: "reductionFailed",
        message: "failed to reduce",
        eventIndex: 3,
        patchIndex: 1,
      },
    });

    render(<App />);

    expect(
      await screen.findByText("Live updates failed for this thread."),
    ).toBeTruthy();
    expect(screen.queryByText("bun run test")).toBeNull();
  });

  it("renders thread items from live state when live state is healthy", async () => {
    const threadId = "thread-live-extends-turn";

    threadsFixture = {
      ok: true,
      data: [
        {
          id: threadId,
          provider: "codex",
          preview: "thread preview",
          createdAt: 1700000000,
          updatedAt: 1700000500,
          cwd: "/tmp/project",
          source: "codex",
        },
      ],
      cursors: {
        codex: null,
        opencode: null,
      },
      errors: {
        codex: null,
        opencode: null,
      },
    };

    readThreadResolver = (targetThreadId: string) => ({
      ok: true,
      thread: buildConversationStateFixture(targetThreadId, "gpt-old-codex", {
        updatedAt: 1700000000,
        turnItems: [
          {
            id: "agent-read-1",
            type: "agentMessage",
            text: "read-canonical-item",
          },
        ],
      }),
    });

    liveStateResolver = (targetThreadId: string, _provider: ProviderId) => ({
      kind: "readLiveState",
      threadId: targetThreadId,
      ownerClientId: "client-1",
      conversationState: buildConversationStateFixture(
        targetThreadId,
        "gpt-old-codex",
        {
          updatedAt: 1700000500,
          turnItems: [
            {
              id: "command-live-1",
              type: "commandExecution",
              command: "bun run lint",
              status: "inProgress",
              aggregatedOutput: "",
              exitCode: null,
              durationMs: null,
            },
          ],
        },
      ),
      liveStateError: null,
    });

    render(<App />);

    expect((await screen.findAllByText("bun run lint")).length).toBeGreaterThan(0);
    expect(screen.queryByText("read-canonical-item")).toBeNull();
  });

  it("does not restore read command items when live reduction fails", async () => {
    const threadId = "thread-live-longer-but-missing-command";
    const commandItem: UnifiedItem = {
      id: "command-keep-1",
      type: "commandExecution",
      command: "git status --short",
      status: "completed",
      aggregatedOutput: " M apps/web/src/App.tsx",
      exitCode: 0,
      durationMs: 44,
    };

    threadsFixture = {
      ok: true,
      data: [
        {
          id: threadId,
          provider: "codex",
          preview: "thread preview",
          createdAt: 1700000000,
          updatedAt: 1700000500,
          cwd: "/tmp/project",
          source: "codex",
        },
      ],
      cursors: {
        codex: null,
        opencode: null,
      },
      errors: {
        codex: null,
        opencode: null,
      },
    };

    readThreadResolver = (targetThreadId: string) => ({
      ok: true,
      thread: buildConversationStateFixture(targetThreadId, "gpt-old-codex", {
        updatedAt: 1700000000,
        turnItems: [commandItem],
      }),
    });

    liveStateResolver = (targetThreadId: string, _provider: ProviderId) => ({
      kind: "readLiveState",
      threadId: targetThreadId,
      ownerClientId: "client-1",
      conversationState: buildConversationStateFixture(
        targetThreadId,
        "gpt-old-codex",
        {
          updatedAt: 1700000500,
          turnItems: [
            {
              id: "agent-1",
              type: "agentMessage",
              text: "Update 1",
            },
            {
              id: "agent-2",
              type: "agentMessage",
              text: "Update 2",
            },
          ],
        },
      ),
      liveStateError: {
        kind: "reductionFailed",
        message: "failed to reduce",
        eventIndex: 5,
        patchIndex: 2,
      },
    });

    render(<App />);

    expect(
      await screen.findByText("Live updates failed for this thread."),
    ).toBeTruthy();
    expect(screen.queryByText("git status --short")).toBeNull();
  });

  it("does not duplicate items when read and live contain the same content with different item ids", async () => {
    const threadId = "thread-no-duplicate-id-drift";

    threadsFixture = {
      ok: true,
      data: [
        {
          id: threadId,
          provider: "codex",
          preview: "thread preview",
          createdAt: 1700000000,
          updatedAt: 1700000500,
          cwd: "/tmp/project",
          source: "codex",
        },
      ],
      cursors: {
        codex: null,
        opencode: null,
      },
      errors: {
        codex: null,
        opencode: null,
      },
    };

    readThreadResolver = (targetThreadId: string) => ({
      ok: true,
      thread: buildConversationStateFixture(targetThreadId, "gpt-old-codex", {
        updatedAt: 1700000000,
        turnItems: [
          {
            id: "read-user-1",
            type: "userMessage",
            content: [{ type: "text", text: "duplicate-check-user" }],
          },
          {
            id: "read-agent-1",
            type: "agentMessage",
            text: "duplicate-check-agent",
          },
        ],
      }),
    });

    liveStateResolver = (targetThreadId: string, _provider: ProviderId) => ({
      kind: "readLiveState",
      threadId: targetThreadId,
      ownerClientId: "client-1",
      conversationState: buildConversationStateFixture(
        targetThreadId,
        "gpt-old-codex",
        {
          updatedAt: 1700000500,
          turnItems: [
            {
              id: "live-user-1",
              type: "userMessage",
              content: [{ type: "text", text: "duplicate-check-user" }],
            },
            {
              id: "live-agent-1",
              type: "agentMessage",
              text: "duplicate-check-agent",
            },
          ],
        },
      ),
      liveStateError: null,
    });

    render(<App />);

    expect(await screen.findByText("duplicate-check-user")).toBeTruthy();
    expect(await screen.findByText("duplicate-check-agent")).toBeTruthy();
    expect(screen.getAllByText("duplicate-check-user").length).toBe(1);
    expect(screen.getAllByText("duplicate-check-agent").length).toBe(1);
  });

  it("shows model default effort when thread effort fields are unset", async () => {
    const threadId = "thread-effort-default";
    const modelId = "gpt-5.3-codex";
    const baseThreadState = buildConversationStateFixture(threadId, modelId, {
      latestReasoningEffort: null,
      collaborationModeReasoningEffort: null,
    });
    const threadState = {
      ...baseThreadState,
      latestReasoningEffort: null,
      latestCollaborationMode: baseThreadState.latestCollaborationMode
        ? {
            ...baseThreadState.latestCollaborationMode,
            settings: {
              ...baseThreadState.latestCollaborationMode.settings,
              reasoningEffort: null,
            },
          }
        : null,
    } satisfies UnifiedThreadFixture;

    threadsFixture = {
      ok: true,
      data: [
        {
          id: threadId,
          provider: "codex",
          preview: "thread preview",
          createdAt: 1700000000,
          updatedAt: 1700000000,
          cwd: "/tmp/project",
          source: "codex",
        },
      ],
      cursors: {
        codex: null,
        opencode: null,
      },
      errors: {
        codex: null,
        opencode: null,
      },
    };

    collaborationModesFixture = {
      codex: [
        {
          name: "Default",
          mode: "default",
          model: null,
          reasoningEffort: null,
          developerInstructions: null,
        },
      ],
      opencode: [],
    };

    modelsFixture = {
      codex: [
        {
          id: modelId,
          displayName: modelId,
          description: "Default model",
          defaultReasoningEffort: "xhigh",
          supportedReasoningEfforts: [
            "minimal",
            "low",
            "medium",
            "high",
            "xhigh",
          ],
          hidden: false,
          isDefault: true,
        },
      ],
      opencode: [],
    };

    readThreadResolver = (targetThreadId: string) => ({
      ok: true,
      thread: {
        ...threadState,
        id: targetThreadId,
      },
    });

    liveStateResolver = (targetThreadId: string, _provider: ProviderId) => ({
      kind: "readLiveState",
      threadId: targetThreadId,
      ownerClientId: "client-1",
      conversationState: {
        ...threadState,
        id: targetThreadId,
      },
      liveStateError: null,
    });

    render(<App />);
    await waitFor(() => {
      const effortPicker = screen.getAllByRole("combobox")[1];
      if (!effortPicker) {
        throw new Error("Effort picker is missing");
      }
      expect(effortPicker.textContent).toContain("xhigh");
    });
  });

  it("prefers selected mode default effort over model default when thread effort is unset", async () => {
    const threadId = "thread-mode-default-effort";
    const modelId = "gpt-5.3-codex";
    const baseThreadState = buildConversationStateFixture(threadId, modelId, {
      latestReasoningEffort: null,
      collaborationModeReasoningEffort: null,
    });
    const threadState = {
      ...baseThreadState,
      latestReasoningEffort: null,
      latestCollaborationMode: baseThreadState.latestCollaborationMode
        ? {
            ...baseThreadState.latestCollaborationMode,
            settings: {
              ...baseThreadState.latestCollaborationMode.settings,
              reasoningEffort: null,
            },
          }
        : null,
    } satisfies UnifiedThreadFixture;

    threadsFixture = {
      ok: true,
      data: [
        {
          id: threadId,
          provider: "codex",
          preview: "thread preview",
          createdAt: 1700000000,
          updatedAt: 1700000000,
          cwd: "/tmp/project",
          source: "codex",
        },
      ],
      cursors: {
        codex: null,
        opencode: null,
      },
      errors: {
        codex: null,
        opencode: null,
      },
    };

    collaborationModesFixture = {
      codex: [
        {
          name: "Default",
          mode: "default",
          model: null,
          reasoningEffort: "xhigh",
          developerInstructions: null,
        },
      ],
      opencode: [],
    };

    modelsFixture = {
      codex: [
        {
          id: modelId,
          displayName: modelId,
          description: "Default model",
          defaultReasoningEffort: "medium",
          supportedReasoningEfforts: [
            "minimal",
            "low",
            "medium",
            "high",
            "xhigh",
          ],
          hidden: false,
          isDefault: true,
        },
      ],
      opencode: [],
    };

    readThreadResolver = (targetThreadId: string) => ({
      ok: true,
      thread: {
        ...threadState,
        id: targetThreadId,
      },
    });

    liveStateResolver = (targetThreadId: string, _provider: ProviderId) => ({
      kind: "readLiveState",
      threadId: targetThreadId,
      ownerClientId: "client-1",
      conversationState: {
        ...threadState,
        id: targetThreadId,
      },
      liveStateError: null,
    });

    render(<App />);
    await waitFor(() => {
      const effortPicker = screen.getAllByRole("combobox")[1];
      if (!effortPicker) {
        throw new Error("Effort picker is missing");
      }
      expect(effortPicker.textContent).toContain("xhigh");
    });
  });
});

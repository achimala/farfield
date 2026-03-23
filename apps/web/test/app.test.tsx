import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  JsonValue,
  UnifiedFeatureAvailability,
  UnifiedFeatureId,
  UnifiedItem,
  UnifiedThread,
} from "@farfield/unified-surface";
import {
  App,
  normalizeCachedThreadViewStateForStorage,
  normalizeReadThreadResponseForChatWindow,
  pruneMapToRetainedKeys,
  retainStreamEventsForView,
} from "../src/App";

type MaybePromise<T> = T | Promise<T>;

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

class MockEventSource {
  private static instances: MockEventSource[] = [];
  public onopen: ((event: Event) => void) | null = null;
  public onmessage: ((event: MessageEvent<string>) => void) | null = null;
  public onerror: ((event: Event) => void) | null = null;

  public constructor(_url: string) {
    MockEventSource.instances.push(this);
  }

  public close(): void {
    MockEventSource.instances = MockEventSource.instances.filter(
      (instance) => instance !== this,
    );
  }

  public static emit(
    payload: Record<
      string,
      object | string | number | boolean | null | undefined
    >,
  ): void {
    const event = new MessageEvent<string>("message", {
      data: JSON.stringify(payload),
    });
    for (const instance of [...MockEventSource.instances]) {
      instance.onmessage?.(event);
    }
  }

  public static emitOpen(): void {
    const event = new Event("open");
    for (const instance of [...MockEventSource.instances]) {
      instance.onopen?.(event);
    }
  }

  public static emitError(): void {
    const event = new Event("error");
    for (const instance of [...MockEventSource.instances]) {
      instance.onerror?.(event);
    }
  }

  public static reset(): void {
    MockEventSource.instances = [];
  }
}

vi.stubGlobal("EventSource", MockEventSource);

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
  options?: {
    includeTurns: boolean;
    maxRenderableItems: number | null;
  },
) => MaybePromise<{
  ok: true;
  thread: UnifiedThreadFixture;
} | null>;

let liveStateResolver: (
  threadId: string,
  provider: ProviderId,
  options?: {
    maxRenderableItems?: number;
  },
) => MaybePromise<{
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
}>;

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
  const latestReasoningEffort = options?.latestReasoningEffort ?? "medium";
  const collaborationModeReasoningEffort =
    options?.collaborationModeReasoningEffort ?? "medium";
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
  MockEventSource.reset();
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
  liveStateResolver = (
    threadId: string,
    _provider: ProviderId,
    _options?: { maxRenderableItems?: number },
  ) => ({
      kind: "readLiveState" as const,
      threadId,
      ownerClientId: null,
      conversationState: null,
      liveStateError: null,
    });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
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
      const maxRenderableItemsParam =
        parsedUrl.searchParams.get("maxRenderableItems");
      const maxRenderableItems =
        maxRenderableItemsParam !== null
          ? Number(maxRenderableItemsParam)
          : null;
      const readThread = await readThreadResolver(threadId, provider, {
        includeTurns: parsedUrl.searchParams.get("includeTurns") !== "false",
        maxRenderableItems:
          typeof maxRenderableItems === "number" &&
          Number.isFinite(maxRenderableItems)
            ? maxRenderableItems
            : null,
      });
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
        const maxRenderableItems =
          "maxRenderableItems" in body &&
          typeof body.maxRenderableItems === "number" &&
          Number.isFinite(body.maxRenderableItems)
            ? body.maxRenderableItems
            : undefined;
        return jsonResponse({
          ok: true,
          result: await liveStateResolver(
            body.threadId ?? "",
            body.provider,
            maxRenderableItems !== undefined
              ? { maxRenderableItems }
              : undefined,
          ),
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
  it("retains only the latest token-usage event outside debug view", () => {
    const firstTokenUsageEvent = {
      type: "broadcast",
      method: "thread/tokenUsage/updated",
      params: {
        threadId: "thread-1",
        tokenUsage: {
          total_token_usage: {
            total_tokens: 100,
          },
          last_token_usage: {
            total_tokens: 25,
          },
          model_context_window: 200_000,
        },
      },
    } satisfies JsonValue;
    const secondTokenUsageEvent = {
      type: "broadcast",
      method: "thread/tokenUsage/updated",
      params: {
        threadId: "thread-1",
        tokenUsage: {
          total_token_usage: {
            total_tokens: 140,
          },
          last_token_usage: {
            total_tokens: 40,
          },
          model_context_window: 200_000,
        },
      },
    } satisfies JsonValue;
    const events = [
      { type: "broadcast", method: "threadUpdated", params: {} },
      firstTokenUsageEvent,
      { type: "broadcast", method: "noop", params: { value: "ignored" } },
      secondTokenUsageEvent,
    ] satisfies JsonValue[];

    expect(retainStreamEventsForView(events, "chat")).toEqual([
      secondTokenUsageEvent,
    ]);
    expect(retainStreamEventsForView(events, "debug", 2)).toEqual(
      events.slice(-2),
    );
    expect(
      retainStreamEventsForView(
        [{ type: "broadcast", method: "threadUpdated", params: {} }],
        "chat",
      ),
    ).toEqual([]);
  });

  it("reuses already-windowed readThread responses without cloning", () => {
    const response = {
      thread: buildConversationStateFixture("thread-windowed", "gpt-5.3-codex", {
        turnItems: Array.from({ length: 91 }, (_, index) => ({
          id: `windowed-item-${index}`,
          type: "agentMessage",
          text: `windowed-${index}`,
        })),
      }),
    } satisfies { thread: UnifiedThreadFixture };

    const normalized = normalizeReadThreadResponseForChatWindow(response, 90);

    expect(normalized).toBe(response);
  });

  it("prunes stale thread load revisions to retained thread ids", () => {
    const revisions = new Map<string, number>([
      ["thread-1", 1],
      ["thread-2", 2],
      ["thread-3", 3],
    ]);

    pruneMapToRetainedKeys(revisions, ["thread-2", "thread-3"]);

    expect([...revisions.entries()]).toEqual([
      ["thread-2", 2],
      ["thread-3", 3],
    ]);
  });

  it("counts image-only user messages when trimming chat windows", () => {
    const response = {
      thread: buildConversationStateFixture(
        "thread-windowed-images",
        "gpt-5.3-codex",
        {
          turnItems: Array.from({ length: 95 }, (_, index) => ({
            id: `windowed-image-${index}`,
            type: "userMessage",
            content: [
              {
                type: "image",
                url: `https://example.com/image-${index}.png`,
              },
            ],
          })),
        },
      ),
    } satisfies { thread: UnifiedThreadFixture };

    const normalized = normalizeReadThreadResponseForChatWindow(response, 90);

    expect(normalized?.thread.turns[0]?.items).toHaveLength(91);
    const firstItem = normalized?.thread.turns[0]?.items[0];
    expect(firstItem?.type).toBe("userMessage");
  });

  it("normalizes cached thread state before storing it", () => {
    const oversizedTurnItems: UnifiedItem[] = Array.from(
      { length: 95 },
      (_, index) => ({
        id: `cached-item-${index}`,
        type: "agentMessage",
        text: `cached-message-${index}`,
      }),
    );
    const tokenUsageEvents = [
      {
        type: "broadcast",
        method: "thread/tokenUsage/updated",
        params: {
          threadId: "thread-cache-normalized",
          tokenUsage: {
            total_token_usage: {
              total_tokens: 10,
            },
            last_token_usage: {
              total_tokens: 5,
            },
            model_context_window: 100,
          },
        },
      },
      {
        type: "broadcast",
        method: "thread/tokenUsage/updated",
        params: {
          threadId: "thread-cache-normalized",
          tokenUsage: {
            total_token_usage: {
              total_tokens: 20,
            },
            last_token_usage: {
              total_tokens: 10,
            },
            model_context_window: 100,
          },
        },
      },
    ] satisfies JsonValue[];

    const normalized = normalizeCachedThreadViewStateForStorage(
      {
        readThreadState: {
          thread: buildConversationStateFixture(
            "thread-cache-normalized",
            "gpt-5.3-codex",
            {
              turnItems: oversizedTurnItems,
            },
          ),
        },
        liveState: {
          ok: true,
          threadId: "thread-cache-normalized",
          ownerClientId: "owner-1",
          conversationState: buildConversationStateFixture(
            "thread-cache-normalized",
            "gpt-5.3-codex",
            {
              turnItems: oversizedTurnItems,
            },
          ),
          liveStateError: null,
        },
        streamEvents: tokenUsageEvents,
      },
      {
        activeTab: "chat",
        chatVisibleItemLimit: 90,
      },
    );

    expect(normalized.readThreadState?.thread.turns[0]?.items).toHaveLength(91);
    expect(normalized.liveState?.conversationState?.turns[0]?.items).toHaveLength(
      91,
    );
    expect(normalized.streamEvents).toEqual([tokenUsageEvents[1]]);
  });

  it("renders core sections", async () => {
    render(<App />);
    expect((await screen.findAllByText("Farfield")).length).toBeGreaterThan(0);
    expect(await screen.findByText("No thread selected")).toBeTruthy();
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

    expect(await screen.findByText("direct-route-loaded")).toBeTruthy();
    await waitFor(() =>
      expect(window.location.pathname).toBe(`/threads/${threadId}`),
    );
    expect(screen.queryByText("listed-thread-loaded")).toBeNull();
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

  it("clears a stale route-thread error after a later successful reload", async () => {
    const threadId = "thread-recovered-route";
    let readAttempts = 0;
    window.history.replaceState(null, "", `/threads/${threadId}`);

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
        thread: buildConversationStateFixture(threadId, "gpt-old-codex", {
          provider: provider ?? "codex",
          turnItems: [
            {
              id: "agent-recovered-1",
              type: "agentMessage",
              text: "route-recovered",
            },
          ],
        }),
      };
    };

    liveStateResolver = (targetThreadId: string, provider: ProviderId) => ({
      kind: "readLiveState",
      threadId: targetThreadId,
      ownerClientId: "client-1",
      conversationState: buildConversationStateFixture(
        targetThreadId,
        "gpt-old-codex",
        {
          provider,
          turnItems: [
            {
              id: "agent-recovered-1",
              type: "agentMessage",
              text: "route-recovered",
            },
          ],
        },
      ),
      liveStateError: null,
    });

    render(<App />);

    expect(await screen.findByText("route-recovered")).toBeTruthy();
    await waitFor(() =>
      expect(
        screen.queryByText(`Thread ${threadId} is not registered`),
      ).toBeNull(),
    );
  });

  it("exposes labeled trace inputs on direct debug routes", async () => {
    const threadId = "thread-debug-route";
    window.history.replaceState(null, "", `/threads/${threadId}/debug`);

    readThreadResolver = (
      targetThreadId: string,
      provider: ProviderId | null,
    ) => {
      if (targetThreadId !== threadId) {
        return null;
      }
      return {
        ok: true,
        thread: buildConversationStateFixture(threadId, "gpt-old-codex", {
          provider: provider ?? "codex",
          turnItems: [
            {
              id: "agent-debug-1",
              type: "agentMessage",
              text: "debug-route-loaded",
            },
          ],
        }),
      };
    };

    liveStateResolver = (targetThreadId: string, provider: ProviderId) => ({
      kind: "readLiveState",
      threadId: targetThreadId,
      ownerClientId: "client-1",
      conversationState: buildConversationStateFixture(
        targetThreadId,
        "gpt-old-codex",
        {
          provider,
          turnItems: [
            {
              id: "agent-debug-1",
              type: "agentMessage",
              text: "debug-route-loaded",
            },
          ],
        },
      ),
      liveStateError: null,
    });

    render(<App />);

    expect(await screen.findByText("Trace")).toBeTruthy();

    const traceLabelInput = screen.getByLabelText("Trace label");
    expect(traceLabelInput.getAttribute("name")).toBe("traceLabel");

    const traceNoteInput = screen.getByLabelText("Trace marker note");
    expect(traceNoteInput.getAttribute("name")).toBe("traceNote");
  });

  it("normalizes windows project paths and disambiguates duplicate basenames", async () => {
    projectDirectoriesFixture = {
      codex: [
        "c:\\Users\\testuser\\Documents\\Code\\Projects\\AgentWorkingHome_P",
        "c:\\Users\\testuser\\Documents\\Code\\Projects\\P_AgentTools",
      ],
      opencode: [],
    };

    threadsFixture = {
      ok: true,
      data: [
        {
          id: "thread-agent-home-upper",
          provider: "codex",
          preview: "first agent home thread",
          createdAt: 1700000000,
          updatedAt: 1700000030,
          cwd: "C:\\Users\\testuser\\Documents\\Code\\Projects\\AgentWorkingHome_P",
          source: "vscode",
        },
        {
          id: "thread-agent-home-lower",
          provider: "codex",
          preview: "second agent home thread",
          createdAt: 1700000001,
          updatedAt: 1700000031,
          cwd: "c:\\Users\\testuser\\Documents\\Code\\Projects\\AgentWorkingHome_P",
          source: "vscode",
        },
        {
          id: "thread-worktree-tools",
          provider: "codex",
          preview: "worktree tools thread",
          createdAt: 1700000002,
          updatedAt: 1700000032,
          cwd: "C:\\Users\\testuser\\.codex\\worktrees\\79d7\\P_AgentTools",
          source: "vscode",
        },
        {
          id: "thread-project-tools",
          provider: "codex",
          preview: "project tools thread",
          createdAt: 1700000003,
          updatedAt: 1700000033,
          cwd: "c:\\Users\\testuser\\Documents\\Code\\Projects\\P_AgentTools",
          source: "vscode",
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

    expect(await screen.findByText("AgentWorkingHome_P")).toBeTruthy();
    expect(screen.getAllByText("AgentWorkingHome_P").length).toBe(1);
    expect(screen.getAllByText("P_AgentTools").length).toBe(2);
    expect(
      screen.getByText("C:/Users/testuser/.codex/worktrees/79d7/P_AgentTools"),
    ).toBeTruthy();
    expect(
      screen.getByText("c:/Users/testuser/Documents/Code/Projects/P_AgentTools"),
    ).toBeTruthy();
    expect(screen.getByText("History")).toBeTruthy();
  });

  it("does not mark groups as historical when the provider cannot list project directories", async () => {
    featureMatrixFixture = {
      ok: true,
      features: {
        codex: buildFeatureSet(
          {
            ...codexCapabilities,
            canListProjectDirectories: false,
          },
          {
            enabled: true,
            connected: true,
          },
        ),
        opencode: buildFeatureSet(opencodeCapabilities, {
          enabled: false,
          connected: false,
        }),
      },
    };

    projectDirectoriesFixture = {
      codex: [],
      opencode: [],
    };

    threadsFixture = {
      ok: true,
      data: [
        {
          id: "thread-agent-home-current",
          provider: "codex",
          preview: "current project thread",
          createdAt: 1700000000,
          updatedAt: 1700000030,
          cwd: "C:\\Users\\testuser\\Documents\\Code\\Projects\\AgentWorkingHome_P",
          source: "vscode",
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

    const projectButton = await screen.findByRole("button", {
      name: /AgentWorkingHome_P/,
    });
    expect(projectButton.textContent ?? "").not.toContain("HISTORY");
    expect(screen.queryByText("History")).toBeNull();
  });

  it("clears the History badge when a merged project group includes a current thread", async () => {
    featureMatrixFixture = {
      ok: true,
      features: {
        codex: buildFeatureSet(codexCapabilities, {
          enabled: true,
          connected: true,
        }),
        opencode: buildFeatureSet(opencodeCapabilities, {
          enabled: true,
          connected: true,
        }),
      },
    };

    projectDirectoriesFixture = {
      codex: [],
      opencode: ["c:\\Users\\testuser\\Documents\\Code\\Projects\\P_AgentTools"],
    };

    threadsFixture = {
      ok: true,
      data: [
        {
          id: "thread-tools-history",
          provider: "codex",
          preview: "historical tools thread",
          createdAt: 1700000000,
          updatedAt: 1700000030,
          cwd: "C:\\Users\\testuser\\Documents\\Code\\Projects\\P_AgentTools",
          source: "vscode",
        },
        {
          id: "thread-tools-current",
          provider: "opencode",
          preview: "current tools thread",
          createdAt: 1700000001,
          updatedAt: 1700000031,
          cwd: "C:\\Users\\testuser\\Documents\\Code\\Projects\\P_AgentTools",
          source: "vscode",
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

    expect((await screen.findAllByText("P_AgentTools")).length).toBeGreaterThan(0);
    expect(screen.queryByText("History")).toBeNull();
  });

  it("uses selected thread polling only as an SSE fallback in chat view", async () => {
    const threadId = "thread-live-fallback";
    window.history.replaceState(null, "", `/threads/${threadId}`);
    threadsFixture = {
      ok: true,
      data: [
        {
          id: threadId,
          provider: "codex",
          preview: "live fallback thread",
          createdAt: 1700000000,
          updatedAt: 1700000030,
          cwd: "C:\\Users\\testuser\\Documents\\Code\\Projects\\AgentWorkingHome_P",
          source: "vscode",
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

    let readThreadCallCount = 0;
    readThreadResolver = (
      targetThreadId: string,
      provider: ProviderId | null,
    ) => {
      if (targetThreadId !== threadId) {
        return null;
      }
      readThreadCallCount += 1;
      return {
        ok: true,
        thread: buildConversationStateFixture(threadId, "gpt-old-codex", {
          provider: provider ?? "codex",
          turnItems: [
            {
              id: "agent-live-fallback-1",
              type: "agentMessage",
              text: "live-fallback-ready",
            },
          ],
        }),
      };
    };
    liveStateResolver = (targetThreadId: string, provider: ProviderId) => ({
      kind: "readLiveState",
      threadId: targetThreadId,
      ownerClientId: "client-1",
      conversationState: buildConversationStateFixture(
        targetThreadId,
        "gpt-old-codex",
        {
          provider,
          turnItems: [
            {
              id: "agent-live-fallback-1",
              type: "agentMessage",
              text: "live-fallback-ready",
            },
          ],
        },
      ),
      liveStateError: null,
    });

    render(<App />);

    expect(await screen.findByText("live-fallback-ready")).toBeTruthy();

    await act(async () => {
      MockEventSource.emitOpen();
      await new Promise((resolve) => window.setTimeout(resolve, 300));
    });

    const connectedCallCount = readThreadCallCount;

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 1400));
    });

    expect(readThreadCallCount).toBe(connectedCallCount);

    await act(async () => {
      MockEventSource.emitError();
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(readThreadCallCount).toBeGreaterThan(connectedCallCount),
    );
  });

  it("reloads a larger chat window when showing older messages", async () => {
    const threadId = "thread-windowed-chat";
    const turnItems: UnifiedItem[] = Array.from({ length: 95 }, (_, index) => ({
      id: `agent-windowed-${index}`,
      type: "agentMessage",
      text: `windowed-message-${index}`,
    }));

    window.history.replaceState(null, "", `/threads/${threadId}`);
    threadsFixture = {
      ok: true,
      data: [
        {
          id: threadId,
          provider: "codex",
          preview: "windowed thread",
          createdAt: 1700000000,
          updatedAt: 1700000030,
          cwd: "C:\\Users\\testuser\\Documents\\Code\\Projects\\AgentWorkingHome_P",
          source: "vscode",
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

    let readThreadCallCount = 0;
    readThreadResolver = (
      targetThreadId: string,
      provider: ProviderId | null,
    ) => {
      if (targetThreadId !== threadId) {
        return null;
      }
      readThreadCallCount += 1;
      return {
        ok: true,
        thread: buildConversationStateFixture(threadId, "gpt-old-codex", {
          provider: provider ?? "codex",
          turnItems,
        }),
      };
    };
    liveStateResolver = (targetThreadId: string, provider: ProviderId) => ({
      kind: "readLiveState",
      threadId: targetThreadId,
      ownerClientId: "client-1",
      conversationState: buildConversationStateFixture(
        targetThreadId,
        "gpt-old-codex",
        {
          provider,
          turnItems,
        },
      ),
      liveStateError: null,
    });

    render(<App />);

    expect(await screen.findByText("windowed-message-94")).toBeTruthy();
    expect(screen.queryByText("windowed-message-0")).toBeNull();
    const initialReadThreadCallCount = readThreadCallCount;

    fireEvent.click(await screen.findByRole("button", { name: /show older messages/i }));

    expect(await screen.findByText("windowed-message-0")).toBeTruthy();
    expect(readThreadCallCount).toBeGreaterThan(initialReadThreadCallCount);
  });

  it("ignores stale chat-window loads after a newer debug load finishes first", async () => {
    const threadId = "thread-load-race";
    const staleChatLoad = createDeferred<{
      ok: true;
      thread: UnifiedThreadFixture;
    }>();
    const freshDebugLoad = createDeferred<{
      ok: true;
      thread: UnifiedThreadFixture;
    }>();

    window.history.replaceState(null, "", `/threads/${threadId}`);
    threadsFixture = {
      ok: true,
      data: [
        {
          id: threadId,
          provider: "codex",
          preview: "race thread",
          createdAt: 1700000000,
          updatedAt: 1700000030,
          cwd: "C:\\Users\\testuser\\Documents\\Code\\Projects\\AgentWorkingHome_P",
          source: "vscode",
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
      options,
    ) => {
      if (targetThreadId !== threadId) {
        return null;
      }

      if (options?.maxRenderableItems === null) {
        return freshDebugLoad.promise;
      }

      return staleChatLoad.promise;
    };
    liveStateResolver = (targetThreadId: string, _provider: ProviderId) => ({
      kind: "readLiveState",
      threadId: targetThreadId,
      ownerClientId: "client-1",
      conversationState: null,
      liveStateError: null,
    });

    render(<App />);

    await act(async () => {
      window.history.replaceState(null, "", `/threads/${threadId}/debug`);
      window.dispatchEvent(new PopStateEvent("popstate"));
      await Promise.resolve();
    });

    await act(async () => {
      freshDebugLoad.resolve({
        ok: true,
        thread: {
          ...buildConversationStateFixture(threadId, "gpt-old-codex", {
            provider: "codex",
            turnItems: [
              {
                id: "agent-debug-fresh-1",
                type: "agentMessage",
                text: "fresh-debug-state",
              },
            ],
          }),
          title: "Fresh Debug Title",
        },
      });
      await Promise.resolve();
    });

    expect((await screen.findAllByText("Fresh Debug Title")).length).toBeGreaterThan(
      0,
    );

    await act(async () => {
      staleChatLoad.resolve({
        ok: true,
        thread: {
          ...buildConversationStateFixture(threadId, "gpt-old-codex", {
            provider: "codex",
            turnItems: [
              {
                id: "agent-chat-stale-1",
                type: "agentMessage",
                text: "stale-chat-state",
              },
            ],
          }),
          title: "Stale Chat Title",
        },
      });
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(screen.queryByText("Stale Chat Title")).toBeNull(),
    );
    expect(screen.getAllByText("Fresh Debug Title").length).toBeGreaterThan(0);
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
    expect(
      await screen.findByRole("button", { name: /site/ }),
    ).toBeTruthy();
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

    const projA = await screen.findByRole("button", { name: /proj-a/ });
    const projB = await screen.findByRole("button", { name: /proj-b/ });

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

    MockEventSource.emit({
      kind: "threadUpdated",
      threadId,
      provider: "codex",
      thread: buildConversationStateFixture(threadId, modelId),
    });

    await waitFor(
      () => {
        expect(latestObservedModel).toBe("gpt-new-codex");
      },
      { timeout: 5000 },
    );
    expect(latestObservedModel).toBe("gpt-new-codex");
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
      thread: buildConversationStateFixture(targetThreadId, modelId, {
        latestReasoningEffort: null,
        collaborationModeReasoningEffort: null,
      }),
    });

    liveStateResolver = (targetThreadId: string, _provider: ProviderId) => ({
      kind: "readLiveState",
      threadId: targetThreadId,
      ownerClientId: "client-1",
      conversationState: buildConversationStateFixture(
        targetThreadId,
        modelId,
        {
          latestReasoningEffort: null,
          collaborationModeReasoningEffort: null,
        },
      ),
      liveStateError: null,
    });

    render(<App />);
    expect(await screen.findByText("xhigh")).toBeTruthy();
  });

  it("prefers selected mode default effort over model default when thread effort is unset", async () => {
    const threadId = "thread-mode-default-effort";
    const modelId = "gpt-5.3-codex";

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
      thread: buildConversationStateFixture(targetThreadId, modelId, {
        latestReasoningEffort: null,
        collaborationModeReasoningEffort: null,
      }),
    });

    liveStateResolver = (targetThreadId: string, _provider: ProviderId) => ({
      kind: "readLiveState",
      threadId: targetThreadId,
      ownerClientId: "client-1",
      conversationState: buildConversationStateFixture(
        targetThreadId,
        modelId,
        {
          latestReasoningEffort: null,
          collaborationModeReasoningEffort: null,
        },
      ),
      liveStateError: null,
    });

    render(<App />);
    expect(await screen.findByText("xhigh")).toBeTruthy();
  });
});

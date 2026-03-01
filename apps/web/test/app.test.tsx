import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  UnifiedFeatureAvailability,
  UnifiedFeatureId,
  UnifiedItem,
} from "@farfield/unified-surface";
import { App } from "../src/App";

class MockEventSource {
  private static instances: MockEventSource[] = [];
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
    for (const instance of MockEventSource.instances) {
      instance.onmessage?.(event);
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
  createdAt: number;
  updatedAt: number;
  cwd?: string;
  source?: string;
};

type UnifiedThreadFixture = {
  id: string;
  provider: ProviderId;
  turns: Array<{
    id: string;
    status: string;
    items: UnifiedItem[];
  }>;
  requests: Array<{
    id: string;
    method: "item/tool/requestUserInput";
    params: {
      threadId: string;
      turnId: string;
      itemId: string;
      questions: Array<{
        id: string;
        header: string;
        question: string;
        isOther?: boolean;
        isSecret?: boolean;
        options: Array<{
          label: string;
          description: string;
        }>;
      }>;
    };
    completed?: boolean;
  }>;
  updatedAt: number;
  latestModel: string;
  latestReasoningEffort: string | null;
  latestCollaborationMode: {
    mode: string;
    settings: {
      model: string;
      reasoningEffort: string | null;
      developerInstructions: null;
    };
  };
};

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
    requests: includePendingRequest
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
                  options: [
                    { label: "Option A", description: "Use option A" },
                    { label: "Option B", description: "Use option B" },
                  ],
                },
              ],
            },
          },
        ]
      : [],
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

  it("loads a direct thread route even when provider is not in current thread list page", async () => {
    const threadId = "thread-direct-route";
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

    readThreadResolver = (
      targetThreadId: string,
      provider: ProviderId | null,
    ) => ({
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
    });

    render(<App />);

    expect(await screen.findByText("direct-route-loaded")).toBeTruthy();
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
    expect(await screen.findByRole("button", { name: "site" })).toBeTruthy();
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

    expect(await screen.findByText("bun run lint")).toBeTruthy();
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

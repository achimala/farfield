import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";

class MockEventSource {
  private static instances: MockEventSource[] = [];
  public onmessage: ((event: MessageEvent<string>) => void) | null = null;
  public onerror: ((event: Event) => void) | null = null;

  public constructor(_url: string) {
    MockEventSource.instances.push(this);
  }

  public close(): void {
    MockEventSource.instances = MockEventSource.instances.filter((instance) => instance !== this);
  }

  public static emit(payload: Record<string, object | string | number | boolean | null | undefined>): void {
    const event = new MessageEvent<string>("message", {
      data: JSON.stringify(payload)
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

// jsdom doesn't implement scrollTo or ResizeObserver.
Element.prototype.scrollTo = vi.fn();
window.scrollTo = vi.fn();
vi.stubGlobal("ResizeObserver", class {
  observe() {}
  unobserve() {}
  disconnect() {}
});

vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
  matches: query === "(prefers-color-scheme: dark)",
  media: query,
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn()
})));

const codexCapabilities = {
  canListModels: true,
  canListCollaborationModes: true,
  canSetCollaborationMode: true,
  canSubmitUserInput: true,
  canReadLiveState: true,
  canReadStreamEvents: true,
  canReadRateLimits: true
};

const opencodeCapabilities = {
  canListModels: false,
  canListCollaborationModes: false,
  canSetCollaborationMode: false,
  canSubmitUserInput: false,
  canReadLiveState: false,
  canReadStreamEvents: false,
  canReadRateLimits: false
};

type CapabilityFixture = {
  canListModels: boolean;
  canListCollaborationModes: boolean;
  canSetCollaborationMode: boolean;
  canSubmitUserInput: boolean;
  canReadLiveState: boolean;
  canReadStreamEvents: boolean;
  canReadRateLimits: boolean;
};

let agentsFixture: {
  ok: true;
  agents: Array<{
    id: "codex" | "opencode";
    label: string;
    enabled: boolean;
    connected: boolean;
    capabilities: CapabilityFixture;
    projectDirectories: string[];
    projectLabels?: Record<string, string>;
  }>;
  defaultAgentId: "codex" | "opencode";
};

let threadsFixture: {
  ok: true;
  data: Array<{
    id: string;
    preview: string;
    createdAt: number;
    updatedAt: number;
    cwd?: string;
    source: "opencode";
    agentId: "codex" | "opencode";
  }>;
  nextCursor: null;
  pages: number;
  truncated: boolean;
};

let collaborationModesFixture: {
  ok: true;
  data: Array<{
    name: string;
    mode: string;
    model: string | null;
    reasoning_effort: string;
    developer_instructions: string | null;
  }>;
};

let modelsFixture: {
  ok: true;
  data: Array<{
    id: string;
    model: string;
    upgrade: null;
    displayName: string;
    description: string;
    supportedReasoningEfforts: Array<{
      reasoningEffort: string;
      description: string;
    }>;
    defaultReasoningEffort: string;
    inputModalities: string[];
    supportsPersonality: boolean;
    isDefault: boolean;
    hidden: boolean;
  }>;
  nextCursor: null;
};

let readThreadResolver: (threadId: string) => {
  ok: true;
  thread: Record<string, object | string | number | boolean | null | undefined>;
  agentId: "codex" | "opencode";
} | null;

let liveStateResolver: (threadId: string) => {
  ok: true;
  threadId: string;
  ownerClientId: string | null;
  conversationState: Record<string, object | string | number | boolean | null | undefined> | null;
};

function buildConversationStateFixture(threadId: string, modelId: string): {
  id: string;
  turns: Array<{
    id: string;
    status: string;
    items: [];
  }>;
  requests: [];
  updatedAt: number;
  latestModel: string;
  latestReasoningEffort: string;
  latestCollaborationMode: {
    mode: string;
    settings: {
      model: string;
      reasoning_effort: string;
      developer_instructions: null;
    };
  };
} {
  return {
    id: threadId,
    turns: [
      {
        id: "turn-1",
        status: "completed",
        items: []
      }
    ],
    requests: [],
    updatedAt: 1700000000,
    latestModel: modelId,
    latestReasoningEffort: "medium",
    latestCollaborationMode: {
      mode: "default",
      settings: {
        model: modelId,
        reasoning_effort: "medium",
        developer_instructions: null
      }
    }
  };
}

beforeEach(() => {
  MockEventSource.reset();
  agentsFixture = {
    ok: true,
    agents: [
      {
        id: "codex",
        label: "Codex",
        enabled: true,
        connected: true,
        capabilities: codexCapabilities,
        projectDirectories: []
      }
    ],
    defaultAgentId: "codex"
  };

  threadsFixture = {
    ok: true,
    data: [],
    nextCursor: null,
    pages: 0,
    truncated: false
  };

  collaborationModesFixture = {
    ok: true,
    data: [
      {
        name: "Default",
        mode: "default",
        model: null,
        reasoning_effort: "medium",
        developer_instructions: null
      },
      {
        name: "Plan",
        mode: "plan",
        model: null,
        reasoning_effort: "medium",
        developer_instructions: "x"
      }
    ]
  };

  modelsFixture = {
    ok: true,
    data: [
      {
        id: "gpt-5.3-codex",
        model: "gpt-5.3-codex",
        upgrade: null,
        displayName: "gpt-5.3-codex",
        description: "Test model",
        supportedReasoningEfforts: [
          {
            reasoningEffort: "medium",
            description: "Balanced"
          }
        ],
        defaultReasoningEffort: "medium",
        inputModalities: ["text"],
        supportsPersonality: true,
        isDefault: true,
        hidden: false
      }
    ],
    nextCursor: null
  };

  readThreadResolver = (_threadId: string) => null;
  liveStateResolver = (threadId: string) => ({
    ok: true,
    threadId,
    ownerClientId: null,
    conversationState: null
  });
});

afterEach(() => {
  cleanup();
});

vi.stubGlobal(
  "fetch",
  vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const parsedUrl = new URL(url, "http://localhost");
    const pathname = parsedUrl.pathname;
    const segments = pathname.split("/").filter((segment) => segment.length > 0);
    const threadId = segments[2] ? decodeURIComponent(segments[2]) : "";

    if (pathname === "/api/health") {
      return {
        ok: true,
        json: async () => ({
          ok: true,
          state: {
            appReady: true,
            ipcConnected: true,
            ipcInitialized: true,
            lastError: null,
            historyCount: 0,
            threadOwnerCount: 0
          }
        })
      } as Response;
    }

    if (pathname.startsWith("/api/threads/") && pathname.endsWith("/live-state")) {
      return {
        ok: true,
        json: async () => liveStateResolver(threadId)
      } as Response;
    }

    if (pathname.startsWith("/api/threads/") && pathname.endsWith("/stream-events")) {
      return {
        ok: true,
        json: async () => ({
          ok: true,
          threadId,
          ownerClientId: null,
          events: []
        })
      } as Response;
    }

    if (pathname.startsWith("/api/threads/") && parsedUrl.searchParams.has("includeTurns")) {
      const readThread = readThreadResolver(threadId);
      if (readThread) {
        return {
          ok: true,
          json: async () => readThread
        } as Response;
      }
    }

    if (pathname === "/api/threads") {
      return {
        ok: true,
        json: async () => threadsFixture
      } as Response;
    }

    if (pathname === "/api/collaboration-modes") {
      return {
        ok: true,
        json: async () => collaborationModesFixture
      } as Response;
    }

    if (pathname === "/api/models") {
      return {
        ok: true,
        json: async () => modelsFixture
      } as Response;
    }

    if (pathname === "/api/debug/trace/status") {
      return {
        ok: true,
        json: async () => ({
          ok: true,
          active: null,
          recent: []
        })
      } as Response;
    }

    if (pathname === "/api/debug/history") {
      return {
        ok: true,
        json: async () => ({
          ok: true,
          history: []
        })
      } as Response;
    }

    if (pathname === "/api/agents") {
      return {
        ok: true,
        json: async () => agentsFixture
      } as Response;
    }

    if (pathname === "/api/account/rate-limits") {
      return {
        ok: false,
        status: 400,
        json: async () => ({ ok: false, error: "No agent supports rate limit reading" })
      } as Response;
    }

    return {
      ok: true,
      json: async () => ({
        ok: true,
        threadId: "t",
        ownerClientId: null,
        conversationState: null,
        events: []
      })
    } as Response;
  })
);

describe("App", () => {
  it("renders core sections", async () => {
    render(<App />);
    expect((await screen.findAllByText("Farfield")).length).toBeGreaterThan(0);
    expect(await screen.findByText("No thread selected")).toBeTruthy();
  });

  it("hides mode controls when capability is disabled", async () => {
    agentsFixture = {
      ok: true,
      agents: [
        {
          id: "opencode",
          label: "OpenCode",
          enabled: true,
          connected: true,
          capabilities: opencodeCapabilities,
          projectDirectories: []
        }
      ],
      defaultAgentId: "opencode"
    };

    render(<App />);
    await screen.findAllByText("Farfield");
    expect(screen.queryByText("Plan")).toBeNull();
  });

  it("shows mode controls when capability is enabled", async () => {
    render(<App />);
    expect(await screen.findByText("Plan")).toBeTruthy();
  });

  it("shows Codex workspace labels for project groups when present", async () => {
    agentsFixture = {
      ok: true,
      agents: [
        {
          id: "codex",
          label: "Codex",
          enabled: true,
          connected: true,
          capabilities: codexCapabilities,
          projectDirectories: [],
          projectLabels: {
            "/tmp/site": "renamed-site"
          }
        }
      ],
      defaultAgentId: "codex"
    };

    threadsFixture = {
      ok: true,
      data: [
        {
          id: "thread-site",
          preview: "thread in renamed project",
          createdAt: 1700000000,
          updatedAt: 1700000001,
          cwd: "/tmp/site",
          source: "opencode",
          agentId: "codex"
        }
      ],
      nextCursor: null,
      pages: 1,
      truncated: false
    };

    render(<App />);
    expect(await screen.findByRole("button", { name: "renamed-site" })).toBeTruthy();
  });
  it("updates the picker when remote model changes with same updatedAt and turns", async () => {
    const threadId = "thread-1";
    let modelId = "gpt-old-codex";

    threadsFixture = {
      ok: true,
      data: [
        {
          id: threadId,
          preview: "thread preview",
          createdAt: 1700000000,
          updatedAt: 1700000000,
          cwd: "/tmp/project",
          source: "opencode",
          agentId: "codex"
        }
      ],
      nextCursor: null,
      pages: 1,
      truncated: false
    };

    modelsFixture = {
      ok: true,
      data: [
        {
          id: "gpt-old-codex",
          model: "gpt-old-codex",
          upgrade: null,
          displayName: "gpt-old-codex",
          description: "Old model",
          supportedReasoningEfforts: [
            {
              reasoningEffort: "medium",
              description: "Balanced"
            }
          ],
          defaultReasoningEffort: "medium",
          inputModalities: ["text"],
          supportsPersonality: true,
          isDefault: false,
          hidden: false
        },
        {
          id: "gpt-new-codex",
          model: "gpt-new-codex",
          upgrade: null,
          displayName: "gpt-new-codex",
          description: "New model",
          supportedReasoningEfforts: [
            {
              reasoningEffort: "medium",
              description: "Balanced"
            }
          ],
          defaultReasoningEffort: "medium",
          inputModalities: ["text"],
          supportsPersonality: true,
          isDefault: true,
          hidden: false
        }
      ],
      nextCursor: null
    };

    readThreadResolver = (targetThreadId: string) => ({
      ok: true,
      thread: buildConversationStateFixture(targetThreadId, modelId),
      agentId: "codex"
    });

    liveStateResolver = (targetThreadId: string) => ({
      ok: true,
      threadId: targetThreadId,
      ownerClientId: "client-1",
      conversationState: buildConversationStateFixture(targetThreadId, modelId)
    });

    render(<App />);
    expect(await screen.findByText("gpt-old-codex")).toBeTruthy();

    modelId = "gpt-new-codex";

    MockEventSource.emit({
      type: "history",
      entry: {
        source: "app",
        meta: {
          threadId
        }
      }
    });

    await waitFor(() => {
      expect(screen.queryByText("gpt-old-codex")).toBeNull();
    });

    expect(await screen.findByText("gpt-new-codex")).toBeTruthy();
  });
});

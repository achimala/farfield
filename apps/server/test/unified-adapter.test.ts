import { describe, expect, it } from "vitest";
import {
  UnifiedCommandSchema,
  UNIFIED_COMMAND_KINDS,
  type UnifiedCommand,
  type UnifiedCommandKind,
  type UnifiedProviderId
} from "@farfield/unified-surface";
import type { ThreadConversationState } from "@farfield/protocol";
import {
  AgentUnifiedProviderAdapter,
  FEATURE_ID_BY_COMMAND_KIND,
  UnifiedBackendFeatureError,
  buildUnifiedFeatureMatrix
} from "../src/unified/adapter.js";
import type { AgentAdapter, AgentCapabilities } from "../src/agents/types.js";

const SAMPLE_THREAD: ThreadConversationState = {
  id: "thread-1",
  turns: [],
  requests: [],
  createdAt: 1700000000,
  updatedAt: 1700000100,
  title: "Thread",
  latestModel: null,
  latestReasoningEffort: null
};

const SAMPLE_THREAD_LIST_ITEM = {
  id: "thread-1",
  preview: "Thread",
  title: "Named Thread",
  createdAt: 1700000000,
  updatedAt: 1700000100,
  source: "codex"
};

const CODEx_CAPABILITIES: AgentCapabilities = {
  canListModels: true,
  canListCollaborationModes: true,
  canSetCollaborationMode: true,
  canSubmitUserInput: true,
  canReadLiveState: true,
  canReadStreamEvents: true
};

const OPENCODE_CAPABILITIES: AgentCapabilities = {
  canListModels: false,
  canListCollaborationModes: false,
  canSetCollaborationMode: false,
  canSubmitUserInput: false,
  canReadLiveState: false,
  canReadStreamEvents: false
};

function createCodexAdapter(): AgentAdapter {
  return {
    id: "codex",
    label: "Codex",
    capabilities: CODEx_CAPABILITIES,
    async start() {},
    async stop() {},
    isEnabled() {
      return true;
    },
    isConnected() {
      return true;
    },
    async listThreads() {
      return {
        data: [SAMPLE_THREAD_LIST_ITEM],
        nextCursor: null
      };
    },
    async createThread() {
      return {
        threadId: SAMPLE_THREAD.id,
        thread: SAMPLE_THREAD_LIST_ITEM
      };
    },
    async readThread() {
      return {
        thread: SAMPLE_THREAD
      };
    },
    async sendMessage() {},
    async interrupt() {},
    async listModels() {
      return {
        data: [{
          id: "gpt-5.3-codex",
          displayName: "GPT-5.3 Codex",
          description: "Model",
          supportedReasoningEfforts: ["low", "medium", "high"]
        }]
      };
    },
    async listCollaborationModes() {
      return {
        data: [{
          name: "Plan",
          mode: "plan",
          settings: {
            model: "gpt-5.3-codex",
            reasoning_effort: "high",
            developer_instructions: "plan mode"
          }
        }]
      };
    },
    async setCollaborationMode(input) {
      return {
        ownerClientId: input.ownerClientId ?? "owner-1"
      };
    },
    async submitUserInput(input) {
      return {
        ownerClientId: input.ownerClientId ?? "owner-1",
        requestId: input.requestId
      };
    },
    async readLiveState() {
      return {
        ownerClientId: "owner-1",
        conversationState: SAMPLE_THREAD,
        liveStateError: null
      };
    },
    async readStreamEvents() {
      return {
        ownerClientId: "owner-1",
        events: [{
          type: "request",
          requestId: "req-1",
          method: "thread/read",
          params: {
            threadId: SAMPLE_THREAD.id
          }
        }]
      };
    }
  };
}

function createOpenCodeAdapter(): AgentAdapter {
  return {
    id: "opencode",
    label: "OpenCode",
    capabilities: OPENCODE_CAPABILITIES,
    async start() {},
    async stop() {},
    isEnabled() {
      return true;
    },
    isConnected() {
      return true;
    },
    async listThreads() {
      return {
        data: [{
          ...SAMPLE_THREAD_LIST_ITEM,
          source: "opencode"
        }],
        nextCursor: null
      };
    },
    async createThread() {
      return {
        threadId: SAMPLE_THREAD.id,
        thread: {
          ...SAMPLE_THREAD_LIST_ITEM,
          source: "opencode"
        }
      };
    },
    async readThread() {
      return {
        thread: {
          ...SAMPLE_THREAD,
          source: "opencode"
        }
      };
    },
    async sendMessage() {},
    async interrupt() {},
    async listProjectDirectories() {
      return ["/tmp/project"];
    }
  };
}

function createCommand(kind: UnifiedCommandKind, provider: UnifiedProviderId): UnifiedCommand {
  switch (kind) {
    case "listThreads":
      return UnifiedCommandSchema.parse({
        kind,
        provider,
        limit: 30,
        archived: false,
        all: true,
        maxPages: 10,
        cursor: null
      });
    case "createThread":
      return UnifiedCommandSchema.parse({
        kind,
        provider,
        cwd: "/tmp/project"
      });
    case "readThread":
      return UnifiedCommandSchema.parse({
        kind,
        provider,
        threadId: SAMPLE_THREAD.id,
        includeTurns: true
      });
    case "sendMessage":
      return UnifiedCommandSchema.parse({
        kind,
        provider,
        threadId: SAMPLE_THREAD.id,
        text: "hello"
      });
    case "interrupt":
      return UnifiedCommandSchema.parse({
        kind,
        provider,
        threadId: SAMPLE_THREAD.id
      });
    case "listModels":
      return UnifiedCommandSchema.parse({
        kind,
        provider,
        limit: 50
      });
    case "listCollaborationModes":
      return UnifiedCommandSchema.parse({
        kind,
        provider
      });
    case "setCollaborationMode":
      return UnifiedCommandSchema.parse({
        kind,
        provider,
        threadId: SAMPLE_THREAD.id,
        ownerClientId: "owner-1",
        collaborationMode: {
          mode: "plan",
          settings: {
            model: "gpt-5.3-codex",
            reasoningEffort: "high",
            developerInstructions: "plan"
          }
        }
      });
    case "submitUserInput":
      return UnifiedCommandSchema.parse({
        kind,
        provider,
        threadId: SAMPLE_THREAD.id,
        ownerClientId: "owner-1",
        requestId: "req-1",
        response: {
          answers: {
            question1: {
              answers: ["yes"]
            }
          }
        }
      });
    case "readLiveState":
      return UnifiedCommandSchema.parse({
        kind,
        provider,
        threadId: SAMPLE_THREAD.id
      });
    case "readStreamEvents":
      return UnifiedCommandSchema.parse({
        kind,
        provider,
        threadId: SAMPLE_THREAD.id,
        limit: 20
      });
    case "listProjectDirectories":
      return UnifiedCommandSchema.parse({
        kind,
        provider
      });
  }
}

describe("unified provider adapters", () => {
  it("has full command handler coverage for both providers", () => {
    const codexUnified = new AgentUnifiedProviderAdapter("codex", createCodexAdapter());
    const opencodeUnified = new AgentUnifiedProviderAdapter("opencode", createOpenCodeAdapter());

    expect(Object.keys(codexUnified.handlers).sort()).toEqual([...UNIFIED_COMMAND_KINDS].sort());
    expect(Object.keys(opencodeUnified.handlers).sort()).toEqual([...UNIFIED_COMMAND_KINDS].sort());
  });

  it("builds a complete typed feature matrix", () => {
    const matrix = buildUnifiedFeatureMatrix({
      codex: createCodexAdapter(),
      opencode: createOpenCodeAdapter()
    });

    expect(matrix.codex.listThreads.status).toBe("available");
    expect(matrix.opencode.listProjectDirectories.status).toBe("available");
    expect(matrix.opencode.listModels.status).toBe("unavailable");
    if (matrix.opencode.listModels.status === "unavailable") {
      expect(matrix.opencode.listModels.reason).toBe("unsupportedByProvider");
    }
  });

  it("handles every command kind for both providers", async () => {
    const codexUnified = new AgentUnifiedProviderAdapter("codex", createCodexAdapter());
    const opencodeUnified = new AgentUnifiedProviderAdapter("opencode", createOpenCodeAdapter());
    const matrix = buildUnifiedFeatureMatrix({
      codex: createCodexAdapter(),
      opencode: createOpenCodeAdapter()
    });

    for (const kind of UNIFIED_COMMAND_KINDS) {
      const featureId = FEATURE_ID_BY_COMMAND_KIND[kind];
      const codexAvailability = matrix.codex[featureId];
      if (codexAvailability.status === "available") {
        const codexResult = await codexUnified.execute(createCommand(kind, "codex"));
        expect(codexResult.kind).toBe(kind);
        if (codexResult.kind === "listThreads") {
          expect(codexResult.data[0]?.title).toBe("Named Thread");
        }
      } else {
        await expect(codexUnified.execute(createCommand(kind, "codex"))).rejects.toBeInstanceOf(
          UnifiedBackendFeatureError
        );
      }

      const opencodeAvailability = matrix.opencode[featureId];
      if (opencodeAvailability.status === "available") {
        const opencodeResult = await opencodeUnified.execute(createCommand(kind, "opencode"));
        expect(opencodeResult.kind).toBe(kind);
        if (opencodeResult.kind === "listThreads") {
          expect(opencodeResult.data[0]?.title).toBe("Named Thread");
        }
        continue;
      }

      await expect(opencodeUnified.execute(createCommand(kind, "opencode"))).rejects.toBeInstanceOf(
        UnifiedBackendFeatureError
      );
    }
  });
});

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { AppServerRpcError, type AppServerClient } from "@farfield/api";
import type {
  IpcFrame,
  ThreadConversationState,
  ThreadStreamStateChangedBroadcast,
} from "@farfield/protocol";
import {
  CodexAgentAdapter,
  buildArchivedThreadConversationStateFromJsonl,
  collectThreadStreamStateChangedEvents,
} from "../src/agents/adapters/codex-agent.js";

const SAMPLE_THREAD_STATE: ThreadConversationState = {
  id: "thread-1",
  turns: [],
  requests: [],
  createdAt: 1700000000,
  updatedAt: 1700000100,
  title: "Thread",
  latestModel: null,
  latestReasoningEffort: null,
};

function buildSnapshotEvent(): ThreadStreamStateChangedBroadcast {
  return {
    type: "broadcast",
    method: "thread-stream-state-changed",
    sourceClientId: "owner-1",
    version: 1,
    params: {
      conversationId: "thread-1",
      change: {
        type: "snapshot",
        conversationState: SAMPLE_THREAD_STATE,
      },
      version: 1,
      type: "thread-stream-state-changed",
    },
  };
}

describe("collectThreadStreamStateChangedEvents", () => {
  it("ignores unrelated thread broadcast frames", () => {
    const archivedEvent: IpcFrame = {
      type: "broadcast",
      method: "thread-archived",
      sourceClientId: "owner-1",
      version: 2,
      params: {
        conversationId: "thread-1",
        hostId: "local",
        cwd: "C:\\repo",
      },
    };

    const result = collectThreadStreamStateChangedEvents([
      buildSnapshotEvent(),
      archivedEvent,
    ]);

    expect(result.parseError).toBeNull();
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.params.conversationId).toBe("thread-1");
  });

  it("still reports malformed thread-stream-state-changed frames", () => {
    const malformedEvent: IpcFrame = {
      type: "broadcast",
      method: "thread-stream-state-changed",
      sourceClientId: "owner-1",
      version: 1,
      params: {
        conversationId: "thread-1",
      },
    };

    const result = collectThreadStreamStateChangedEvents([malformedEvent]);

    expect(result.events).toHaveLength(0);
    expect(result.parseError?.eventIndex).toBe(0);
    expect(result.parseError?.message).toContain("params.change");
  });
});

describe("buildArchivedThreadConversationStateFromJsonl", () => {
  it("rebuilds a minimal thread state from archived rollout events", () => {
    const jsonl = [
      JSON.stringify({
        timestamp: "2026-03-19T10:41:10.772Z",
        type: "session_meta",
        payload: {
          type: "session_meta",
          id: "thread-archive-1",
          cwd: "C:\\repo",
          source: "vscode",
        },
      }),
      JSON.stringify({
        timestamp: "2026-03-19T10:41:22.961Z",
        type: "event_msg",
        payload: {
          type: "task_started",
          turn_id: "turn-1",
        },
      }),
      JSON.stringify({
        timestamp: "2026-03-19T10:41:22.962Z",
        type: "event_msg",
        payload: {
          type: "user_message",
          message: "hello",
          images: ["https://example.com/image.png"],
          local_images: [],
          text_elements: [],
        },
      }),
      JSON.stringify({
        timestamp: "2026-03-19T10:41:23.000Z",
        type: "event_msg",
        payload: {
          type: "agent_message",
          message: "working on it",
          phase: "commentary",
        },
      }),
      JSON.stringify({
        timestamp: "2026-03-19T10:41:23.100Z",
        type: "event_msg",
        payload: {
          type: "reasoning",
          summary: ["check logs"],
        },
      }),
      JSON.stringify({
        timestamp: "2026-03-19T10:41:23.200Z",
        type: "event_msg",
        payload: {
          type: "context_compacted",
        },
      }),
      JSON.stringify({
        timestamp: "2026-03-19T10:41:23.300Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: 1,
              output_tokens: 2,
              total_tokens: 3,
            },
          },
        },
      }),
      JSON.stringify({
        timestamp: "2026-03-19T10:41:23.400Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-1",
        },
      }),
    ].join("\n");

    const result = buildArchivedThreadConversationStateFromJsonl(
      jsonl,
      "thread-archive-1",
      {
        title: "Archived thread",
        updatedAt: 1710844883,
      },
    );

    expect(result).not.toBeNull();
    expect(result?.title).toBe("Archived thread");
    expect(result?.cwd).toBe("C:\\repo");
    expect(result?.source).toBe("vscode");
    expect(result?.turns).toHaveLength(1);
    expect(result?.turns[0]?.turnId).toBe("turn-1");
    expect(result?.turns[0]?.status).toBe("completed");
    expect(result?.turns[0]?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "userMessage" }),
        expect.objectContaining({ type: "agentMessage", text: "working on it" }),
        expect.objectContaining({ type: "reasoning", summary: ["check logs"] }),
        expect.objectContaining({ type: "contextCompaction" }),
      ]),
    );
    expect(result?.latestTokenUsageInfo).toEqual({
      total_token_usage: {
        input_tokens: 1,
        output_tokens: 2,
        total_tokens: 3,
      },
    });
  });

  it("rebuilds legacy tool payloads into bounded dynamic tool items", () => {
    const longOutput = "x".repeat(400);
    const jsonl = [
      JSON.stringify({
        timestamp: "2026-03-20T14:40:00.000Z",
        type: "session_meta",
        payload: {
          type: "session_meta",
          id: "thread-archive-tools",
          cwd: "C:\\repo",
          source: "vscode",
          model: "gpt-5.3-codex",
          reasoning_effort: "high",
        },
      }),
      JSON.stringify({
        timestamp: "2026-03-20T14:40:01.000Z",
        type: "event_msg",
        payload: {
          type: "task_started",
          turn_id: "turn-tools-1",
        },
      }),
      JSON.stringify({
        timestamp: "2026-03-20T14:40:01.100Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "developer",
          content: [
            {
              type: "input_text",
              text: "Follow the runtime hardening checklist.",
            },
          ],
        },
      }),
      JSON.stringify({
        timestamp: "2026-03-20T14:40:01.200Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          phase: "commentary",
          content: [
            {
              type: "output_text",
              text: "Inspecting archived replay coverage now.",
            },
          ],
        },
      }),
      JSON.stringify({
        timestamp: "2026-03-20T14:40:02.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "shell_command",
          arguments: JSON.stringify({
            command: "Get-ChildItem",
            workdir: "C:\\repo",
          }),
          call_id: "call-function-1",
        },
      }),
      JSON.stringify({
        timestamp: "2026-03-20T14:40:03.000Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "call-function-1",
          output: {
            body: longOutput,
            success: true,
          },
        },
      }),
      JSON.stringify({
        timestamp: "2026-03-20T14:40:04.000Z",
        type: "response_item",
        payload: {
          type: "custom_tool_call",
          call_id: "call-custom-1",
          name: "ask_user",
          input: "Need confirmation",
        },
      }),
      JSON.stringify({
        timestamp: "2026-03-20T14:40:05.000Z",
        type: "response_item",
        payload: {
          type: "custom_tool_call_output",
          call_id: "call-custom-1",
          output: {
            body: [
              {
                type: "input_text",
                text: "Confirmed by user",
              },
            ],
            success: false,
          },
        },
      }),
      JSON.stringify({
        timestamp: "2026-03-20T14:40:06.000Z",
        type: "event_msg",
        payload: {
          type: "dynamic_tool_call_request",
          callId: "call-dynamic-1",
          turnId: "turn-tools-1",
          tool: "generate_image",
          arguments: {
            prompt: "render an architecture diagram",
          },
        },
      }),
      JSON.stringify({
        timestamp: "2026-03-20T14:40:07.000Z",
        type: "event_msg",
        payload: {
          type: "dynamic_tool_call_response",
          call_id: "call-dynamic-1",
          turn_id: "turn-tools-1",
          tool: "generate_image",
          arguments: {
            prompt: "render an architecture diagram",
          },
          content_items: [
            {
              type: "input_image",
              image_url: "https://example.com/diagram.png",
            },
          ],
          success: true,
          error: null,
          duration: "PT1.25S",
        },
      }),
      JSON.stringify({
        timestamp: "2026-03-20T14:40:08.000Z",
        type: "event_msg",
        payload: {
          type: "todo_list",
          explanation: null,
          plan: [
            {
              step: "Verify archived replay",
              status: "completed",
            },
          ],
        },
      }),
      JSON.stringify({
        timestamp: "2026-03-20T14:40:08.250Z",
        type: "response_item",
        payload: {
          type: "web_search_call",
          status: "completed",
          action: {
            type: "search",
            query: "time: {\"utc_offset\":\"+08:00\"}",
            queries: ['time: {"utc_offset":"+08:00"}'],
          },
        },
      }),
      JSON.stringify({
        timestamp: "2026-03-20T14:40:08.500Z",
        type: "event_msg",
        payload: {
          type: "unknown_future_payload",
          extra: true,
        },
      }),
      JSON.stringify({
        timestamp: "2026-03-20T14:40:09.000Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-tools-1",
        },
      }),
    ].join("\n");

    const result = buildArchivedThreadConversationStateFromJsonl(
      jsonl,
      "thread-archive-tools",
      {
        title: "Archived tools",
        updatedAt: 1710844883,
      },
    );

    expect(result).not.toBeNull();
    expect(result?.latestModel).toBe("gpt-5.3-codex");
    expect(result?.latestReasoningEffort).toBe("high");

    const toolItems =
      result?.turns[0]?.items.filter(
        (item): item is Extract<typeof item, { type: "dynamicToolCall" }> =>
          item.type === "dynamicToolCall",
      ) ?? [];
    expect(toolItems).toHaveLength(4);
    expect(toolItems[0]).toEqual(
      expect.objectContaining({
        type: "dynamicToolCall",
        tool: "shell_command",
        status: "completed",
        success: true,
      }),
    );
    expect(
      toolItems[0]?.contentItems?.[0]?.type === "inputText"
        ? toolItems[0].contentItems[0].text.length
        : 0,
    ).toBeLessThanOrEqual(243);
    expect(toolItems[1]).toEqual(
      expect.objectContaining({
        tool: "ask_user",
        status: "failed",
        success: false,
      }),
    );
    expect(toolItems[2]).toEqual(
      expect.objectContaining({
        tool: "generate_image",
        status: "completed",
        success: true,
        durationMs: 1250,
      }),
    );
    expect(toolItems[2]?.contentItems?.[0]).toEqual({
      type: "inputImage",
      imageUrl: "https://example.com/diagram.png",
    });
    expect(toolItems[3]).toEqual(
      expect.objectContaining({
        tool: "web_search",
        status: "completed",
      }),
    );
    expect(toolItems[3]?.contentItems).toEqual([
      {
        type: "inputText",
        text: 'time: {"utc_offset":"+08:00"}',
      },
    ]);

    expect(result?.turns[0]?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "steeringUserMessage",
        }),
        expect.objectContaining({
          type: "agentMessage",
          text: "Inspecting archived replay coverage now.",
          phase: "commentary",
        }),
      ]),
    );

    const todoItem = result?.turns[0]?.items.find(
      (item) => item.type === "todoList",
    );
    expect(todoItem).toEqual(
      expect.objectContaining({
        type: "todoList",
        plan: [
          {
            step: "Verify archived replay",
            status: "completed",
          },
        ],
      }),
    );
  });

  it("skips malformed trailing jsonl lines and restores earlier archived entries", () => {
    const jsonl = [
      JSON.stringify({
        timestamp: "2026-03-19T10:41:10.772Z",
        type: "session_meta",
        payload: {
          type: "session_meta",
          id: "thread-archive-tail",
          cwd: "C:\\repo",
          source: "vscode",
        },
      }),
      JSON.stringify({
        timestamp: "2026-03-19T10:41:22.961Z",
        type: "event_msg",
        payload: {
          type: "task_started",
          turn_id: "turn-tail-1",
        },
      }),
      JSON.stringify({
        timestamp: "2026-03-19T10:41:22.962Z",
        type: "event_msg",
        payload: {
          type: "agent_message",
          message: "still restorable",
        },
      }),
      '{"timestamp":"2026-03-19T10:41:23.000Z","payload":',
    ].join("\n");

    const result = buildArchivedThreadConversationStateFromJsonl(
      jsonl,
      "thread-archive-tail",
      null,
    );

    expect(result).not.toBeNull();
    expect(result?.turns).toHaveLength(1);
    expect(result?.turns[0]?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "agentMessage",
          text: "still restorable",
        }),
      ]),
    );
  });
});

describe("CodexAgentAdapter runtime retention", () => {
  class TestCodexAgentAdapter extends CodexAgentAdapter {
    public override patchRuntimeState(
      next: Partial<ReturnType<CodexAgentAdapter["getRuntimeState"]>>,
    ): void {
      super.patchRuntimeState(next);
    }

    public override async restoreArchivedThreadState(
      threadId: string,
      includeTurns: boolean,
    ): Promise<ThreadConversationState | null> {
      return super.restoreArchivedThreadState(threadId, includeTurns);
    }

    public override setTrackedThreadOwner(
      threadId: string,
      ownerClientId: string,
    ): void {
      super.setTrackedThreadOwner(threadId, ownerClientId);
    }

    public override setTrackedThreadEvents(
      threadId: string,
      events: IpcFrame[],
    ): void {
      super.setTrackedThreadEvents(threadId, events);
    }

    public override setTrackedThreadSnapshot(
      threadId: string,
      snapshot: ThreadConversationState,
      origin: "stream" | "readThreadWithTurns" | "readThread",
    ): void {
      super.setTrackedThreadSnapshot(threadId, snapshot, origin);
    }

    public override setThreadTitle(
      threadId: string,
      title: string | null | undefined,
    ): void {
      super.setThreadTitle(threadId, title);
    }

    public get appClientForTest(): AppServerClient {
      return this.appClient;
    }
  }

  function createAdapterForTest(): TestCodexAgentAdapter {
    return new TestCodexAgentAdapter({
      appExecutable: "codex",
      socketPath: "\\\\.\\pipe\\farfield-test",
      workspaceDir: process.cwd(),
      userAgent: "farfield-test",
      reconnectDelayMs: 1,
    });
  }

  it("evicts the oldest tracked thread state after the runtime cap", () => {
    const adapter = createAdapterForTest();

    for (let index = 0; index < 82; index += 1) {
      const threadId = `thread-${String(index)}`;
      adapter.setTrackedThreadOwner(threadId, `owner-${String(index)}`);
      adapter.setTrackedThreadSnapshot(
        threadId,
        {
          ...SAMPLE_THREAD_STATE,
          id: threadId,
          title: `Thread ${String(index)}`,
        },
        "stream",
      );
      adapter.setTrackedThreadEvents(threadId, [buildSnapshotEvent()]);
      adapter.setThreadTitle(threadId, `Thread ${String(index)}`);
    }

    const counts = adapter.getTrackedThreadRuntimeCounts();
    expect(counts.trackedThreadCount).toBe(80);
    expect(counts.maxTrackedThreadCountSeen).toBe(80);
    expect(counts.streamEventThreadCount).toBe(80);

    return Promise.all([
      adapter.readStreamEvents("thread-0", 500),
      adapter.readStreamEvents("thread-1", 500),
      adapter.readStreamEvents("thread-80", 500),
      adapter.readStreamEvents("thread-81", 500),
      adapter.readLiveState("thread-0"),
      adapter.readLiveState("thread-81"),
    ]).then(
      ([
        oldestEvents,
        secondOldestEvents,
        newestEventsMinusOne,
        newestEvents,
        oldestLiveState,
        newestLiveState,
      ]) => {
        expect(oldestEvents.events).toEqual([]);
        expect(secondOldestEvents.events).toEqual([]);
        expect(newestEventsMinusOne.events).toHaveLength(1);
        expect(newestEvents.events).toHaveLength(1);
        expect(oldestLiveState.conversationState).toBeNull();
        expect(newestLiveState.conversationState?.id).toBe("thread-81");
        expect(newestLiveState.conversationState?.title).toBe("Thread 81");
      },
    );
  });

  it("truncates buffered stream events per thread to the configured cap", async () => {
    const adapter = createAdapterForTest();
    const events: IpcFrame[] = Array.from({ length: 160 }, (_, index) => ({
      type: "broadcast",
      method: "thread-stream-state-changed",
      sourceClientId: "owner-1",
      version: 1,
      params: {
        conversationId: "thread-cap",
        change: {
          type: "snapshot",
          conversationState: {
            ...SAMPLE_THREAD_STATE,
            id: `thread-cap-${String(index)}`,
          },
        },
        version: 1,
        type: "thread-stream-state-changed",
      },
    }));

    adapter.setTrackedThreadEvents("thread-cap", events);

    const stream = await adapter.readStreamEvents("thread-cap", 500);
    expect(stream.events).toHaveLength(120);
    expect(adapter.getTrackedThreadRuntimeCounts().maxBufferedStreamEventsPerThreadSeen).toBe(
      120,
    );
  });

  it("increments the parse failure counter only for malformed stream-state frames", async () => {
    const adapter = createAdapterForTest();

    adapter.setTrackedThreadEvents("thread-parse", [
      {
        type: "broadcast",
        method: "thread-archived",
        sourceClientId: "owner-1",
        version: 1,
        params: {
          conversationId: "thread-parse",
        },
      },
    ]);

    await adapter.readLiveState("thread-parse");
    expect(adapter.getTrackedThreadRuntimeCounts().streamParseFailureCount).toBe(
      0,
    );

    adapter.setTrackedThreadEvents("thread-parse", [
      {
        type: "broadcast",
        method: "thread-stream-state-changed",
        sourceClientId: "owner-1",
        version: 1,
        params: {
          conversationId: "thread-parse",
        },
      },
    ]);

    const result = await adapter.readLiveState("thread-parse");
    expect(result.liveStateError?.kind).toBe("parseFailed");
    expect(adapter.getTrackedThreadRuntimeCounts().streamParseFailureCount).toBe(
      1,
    );
  });

  it("restores full archived live state after a metadata-only archived read", async () => {
    const adapter = createAdapterForTest();
    const threadId = "thread-archived-live-state";
    const previousCodexHome = process.env["CODEX_HOME"];
    const temporaryCodexHome = await mkdtemp(
      path.join(os.tmpdir(), "farfield-codex-home-"),
    );
    const archivedSessionsDir = path.join(temporaryCodexHome, "archived_sessions");
    const archivedJsonl = [
      JSON.stringify({
        timestamp: "2026-03-19T10:41:10.772Z",
        type: "session_meta",
        payload: {
          type: "session_meta",
          id: threadId,
          cwd: "C:\\repo",
          source: "vscode",
        },
      }),
      JSON.stringify({
        timestamp: "2026-03-19T10:41:22.961Z",
        type: "event_msg",
        payload: {
          type: "task_started",
          turn_id: "turn-archive-live-1",
        },
      }),
      JSON.stringify({
        timestamp: "2026-03-19T10:41:23.000Z",
        type: "event_msg",
        payload: {
          type: "agent_message",
          message: "restored from archive",
        },
      }),
      JSON.stringify({
        timestamp: "2026-03-19T10:41:23.400Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-archive-live-1",
        },
      }),
    ].join("\n");

    try {
      process.env["CODEX_HOME"] = temporaryCodexHome;
      await mkdir(archivedSessionsDir, { recursive: true });
      await writeFile(
        path.join(archivedSessionsDir, `${threadId}.jsonl`),
        archivedJsonl,
        "utf8",
      );

      const metadataOnly = await adapter.restoreArchivedThreadState(threadId, false);
      expect(metadataOnly?.turns).toHaveLength(0);

      const liveState = await adapter.readLiveState(threadId);
      expect(liveState.liveStateError).toBeNull();
      expect(liveState.conversationState?.turns).toHaveLength(1);
      expect(liveState.conversationState?.turns[0]?.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "agentMessage",
            text: "restored from archive",
          }),
        ]),
      );
    } finally {
      if (previousCodexHome === undefined) {
        delete process.env["CODEX_HOME"];
      } else {
        process.env["CODEX_HOME"] = previousCodexHome;
      }
      await rm(temporaryCodexHome, { recursive: true, force: true });
    }
  });

  it("clears runtime lastError after archived readThread fallback succeeds", async () => {
    const adapter = createAdapterForTest();
    const threadId = "thread-archived-read-thread";
    const previousCodexHome = process.env["CODEX_HOME"];
    const temporaryCodexHome = await mkdtemp(
      path.join(os.tmpdir(), "farfield-codex-home-"),
    );
    const archivedSessionsDir = path.join(temporaryCodexHome, "archived_sessions");
    const archivedJsonl = [
      JSON.stringify({
        timestamp: "2026-03-19T10:41:10.772Z",
        type: "session_meta",
        payload: {
          type: "session_meta",
          id: threadId,
          cwd: "C:\\repo",
          source: "vscode",
        },
      }),
      JSON.stringify({
        timestamp: "2026-03-19T10:41:22.961Z",
        type: "event_msg",
        payload: {
          type: "task_started",
          turn_id: "turn-archive-read-1",
        },
      }),
      JSON.stringify({
        timestamp: "2026-03-19T10:41:23.000Z",
        type: "event_msg",
        payload: {
          type: "agent_message",
          message: "fallback restored thread",
        },
      }),
      JSON.stringify({
        timestamp: "2026-03-19T10:41:23.400Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-archive-read-1",
        },
      }),
    ].join("\n");
    const noRolloutError = new AppServerRpcError(
      -32600,
      `app-server error -32600: no rollout found for thread id ${threadId}`,
    );

    try {
      process.env["CODEX_HOME"] = temporaryCodexHome;
      await mkdir(archivedSessionsDir, { recursive: true });
      await writeFile(
        path.join(archivedSessionsDir, `${threadId}.jsonl`),
        archivedJsonl,
        "utf8",
      );

      adapter.patchRuntimeState({
        lastError: noRolloutError.message,
      });
      const readThreadSpy = vi
        .spyOn(adapter.appClientForTest, "readThread")
        .mockRejectedValue(noRolloutError);
      const resumeThreadSpy = vi
        .spyOn(adapter.appClientForTest, "resumeThread")
        .mockRejectedValue(noRolloutError);

      try {
        const result = await adapter.readThread({
          threadId,
          includeTurns: true,
        });

        expect(result.thread.turns).toHaveLength(1);
        expect(adapter.getRuntimeState().lastError).toBeNull();
      } finally {
        readThreadSpy.mockRestore();
        resumeThreadSpy.mockRestore();
      }
    } finally {
      if (previousCodexHome === undefined) {
        delete process.env["CODEX_HOME"];
      } else {
        process.env["CODEX_HOME"] = previousCodexHome;
      }
      await rm(temporaryCodexHome, { recursive: true, force: true });
    }
  });

  it("preserves unrelated readThread errors even when an archived copy exists", async () => {
    const adapter = createAdapterForTest();
    const threadId = "thread-read-thread-transport-error";
    const previousCodexHome = process.env["CODEX_HOME"];
    const temporaryCodexHome = await mkdtemp(
      path.join(os.tmpdir(), "farfield-codex-home-"),
    );
    const archivedSessionsDir = path.join(temporaryCodexHome, "archived_sessions");
    const archivedJsonl = [
      JSON.stringify({
        timestamp: "2026-03-19T10:41:10.772Z",
        type: "session_meta",
        payload: {
          type: "session_meta",
          id: threadId,
          cwd: "C:\\repo",
          source: "vscode",
        },
      }),
      JSON.stringify({
        timestamp: "2026-03-19T10:41:23.000Z",
        type: "event_msg",
        payload: {
          type: "agent_message",
          message: "archived copy should stay unused",
        },
      }),
    ].join("\n");
    const transportError = new Error("app-server transport unavailable");

    try {
      process.env["CODEX_HOME"] = temporaryCodexHome;
      await mkdir(archivedSessionsDir, { recursive: true });
      await writeFile(
        path.join(archivedSessionsDir, `${threadId}.jsonl`),
        archivedJsonl,
        "utf8",
      );

      adapter.patchRuntimeState({
        lastError: null,
      });
      const readThreadSpy = vi
        .spyOn(adapter.appClientForTest, "readThread")
        .mockRejectedValue(transportError);

      try {
        await expect(
          adapter.readThread({
            threadId,
            includeTurns: true,
          }),
        ).rejects.toThrow("app-server transport unavailable");
        expect(adapter.getRuntimeState().lastError).toBe(
          "app-server transport unavailable",
        );
      } finally {
        readThreadSpy.mockRestore();
      }
    } finally {
      if (previousCodexHome === undefined) {
        delete process.env["CODEX_HOME"];
      } else {
        process.env["CODEX_HOME"] = previousCodexHome;
      }
      await rm(temporaryCodexHome, { recursive: true, force: true });
    }
  });

  it("does not match archived rollout files by thread id substring", async () => {
    const adapter = createAdapterForTest();
    const previousCodexHome = process.env["CODEX_HOME"];
    const temporaryCodexHome = await mkdtemp(
      path.join(os.tmpdir(), "farfield-codex-home-"),
    );
    const archivedSessionsDir = path.join(temporaryCodexHome, "archived_sessions");
    const requestedThreadId = "thread-1";
    const otherThreadId = "thread-12";

    try {
      process.env["CODEX_HOME"] = temporaryCodexHome;
      await mkdir(archivedSessionsDir, { recursive: true });
      await writeFile(
        path.join(archivedSessionsDir, `${otherThreadId}.jsonl`),
        [
          JSON.stringify({
            timestamp: "2026-03-19T10:41:10.772Z",
            type: "session_meta",
            payload: {
              type: "session_meta",
              id: otherThreadId,
              cwd: "C:\\repo",
              source: "vscode",
            },
          }),
        ].join("\n"),
        "utf8",
      );

      await expect(
        adapter.restoreArchivedThreadState(requestedThreadId, true),
      ).resolves.toBeNull();
    } finally {
      if (previousCodexHome === undefined) {
        delete process.env["CODEX_HOME"];
      } else {
        process.env["CODEX_HOME"] = previousCodexHome;
      }
      await rm(temporaryCodexHome, { recursive: true, force: true });
    }
  });
});

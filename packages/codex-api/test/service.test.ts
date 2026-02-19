import { describe, expect, it, vi } from "vitest";
import type { ThreadConversationState } from "@farfield/protocol";
import { CodexMonitorService } from "../src/service.js";

function createThread(): ThreadConversationState {
  return {
    id: "thread-1",
    turns: [
      {
        params: {
          threadId: "thread-1",
          input: [{ type: "text", text: "hello" }],
          attachments: []
        },
        status: "completed",
        items: []
      }
    ],
    requests: []
  };
}

describe("CodexMonitorService", () => {
  it("sends message using strict thread template", async () => {
    const ipcClient = {
      sendRequestAndWait: vi.fn().mockResolvedValue({ type: "response", requestId: 1 })
    };

    const service = new CodexMonitorService(ipcClient as never);

    await service.sendMessage({
      threadId: "thread-1",
      ownerClientId: "client-1",
      text: "new message",
      turnStartTemplate: createThread().turns[0]?.params as NonNullable<
        ThreadConversationState["turns"][number]["params"]
      >
    });

    expect(ipcClient.sendRequestAndWait).toHaveBeenCalledWith(
      "thread-follower-start-turn",
      expect.objectContaining({
        conversationId: "thread-1"
      }),
      expect.objectContaining({
        targetClientId: "client-1",
        version: 1
      })
    );
  });

  it("overrides template mode and model when provided", async () => {
    const ipcClient = {
      sendRequestAndWait: vi.fn().mockResolvedValue({ type: "response", requestId: 1 })
    };

    const service = new CodexMonitorService(ipcClient as never);

    await service.sendMessage({
      threadId: "thread-1",
      ownerClientId: "client-1",
      text: "new message",
      turnStartTemplate: createThread().turns[0]?.params as NonNullable<
        ThreadConversationState["turns"][number]["params"]
      >,
      model: "gpt-5.3-codex",
      effort: "high",
      collaborationMode: {
        mode: "plan",
        settings: {
          model: "gpt-5.3-codex",
          reasoning_effort: "high",
          developer_instructions: "plan"
        }
      }
    });

    expect(ipcClient.sendRequestAndWait).toHaveBeenCalledWith(
      "thread-follower-start-turn",
      expect.objectContaining({
        turnStartParams: expect.objectContaining({
          model: "gpt-5.3-codex",
          effort: "high",
          collaborationMode: expect.objectContaining({
            mode: "plan"
          })
        })
      }),
      expect.any(Object)
    );
  });

  it("sends message without a template when none is available", async () => {
    const ipcClient = {
      sendRequestAndWait: vi.fn().mockResolvedValue({ type: "response", requestId: 1 })
    };

    const service = new CodexMonitorService(ipcClient as never);

    await service.sendMessage({
      threadId: "thread-1",
      ownerClientId: "client-1",
      text: "new message without template",
      cwd: "/tmp/project"
    });

    expect(ipcClient.sendRequestAndWait).toHaveBeenCalledWith(
      "thread-follower-start-turn",
      expect.objectContaining({
        conversationId: "thread-1",
        turnStartParams: expect.objectContaining({
          threadId: "thread-1",
          cwd: "/tmp/project",
          input: [
            {
              type: "text",
              text: "new message without template"
            }
          ]
        })
      }),
      expect.any(Object)
    );
  });

  it("submits user input with validated payload", async () => {
    const service = new CodexMonitorService({ sendRequestAndWait: vi.fn().mockResolvedValue({}) } as never);

    await service.submitUserInput({
      threadId: "thread-1",
      ownerClientId: "client-1",
      requestId: 7,
      response: {
        answers: {
          q1: {
            answers: ["Option A"]
          }
        }
      }
    });

    expect(true).toBe(true);
  });
});

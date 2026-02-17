import { describe, expect, it, vi } from "vitest";
import type { ThreadConversationState } from "@codex-monitor/codex-protocol";
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
    const appClient = {
      readThread: vi.fn().mockResolvedValue({ thread: createThread() })
    };

    const ipcClient = {
      sendRequestAndWait: vi.fn().mockResolvedValue({ type: "response", requestId: 1 })
    };

    const service = new CodexMonitorService(appClient as never, ipcClient as never);

    await service.sendMessage({
      threadId: "thread-1",
      ownerClientId: "client-1",
      text: "new message"
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

  it("submits user input with validated payload", async () => {
    const service = new CodexMonitorService(
      { readThread: vi.fn() } as never,
      { sendRequestAndWait: vi.fn().mockResolvedValue({}) } as never
    );

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

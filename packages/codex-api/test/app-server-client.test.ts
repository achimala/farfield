import { describe, expect, it, vi } from "vitest";
import { AppServerClient } from "../src/app-server-client.js";
import type { AppServerTransport } from "../src/app-server-transport.js";

describe("AppServerClient.sendUserMessage", () => {
  it("sends the expected request payload", async () => {
    const transport: AppServerTransport = {
      request: vi.fn().mockResolvedValue({}),
      close: vi.fn().mockResolvedValue(undefined)
    };

    const client = new AppServerClient(transport);
    await client.sendUserMessage("thread-1", "hello");

    expect(transport.request).toHaveBeenCalledWith("sendUserMessage", {
      conversationId: "thread-1",
      items: [
        {
          type: "text",
          data: {
            text: "hello"
          }
        }
      ]
    });
  });

  it("accepts response when server adds extra keys", async () => {
    const transport: AppServerTransport = {
      request: vi.fn().mockResolvedValue({ ok: true }),
      close: vi.fn().mockResolvedValue(undefined)
    };

    const client = new AppServerClient(transport);
    await expect(client.sendUserMessage("thread-1", "hello")).resolves.toBeUndefined();
  });
});

describe("AppServerClient.resumeThread", () => {
  it("sends the expected resume request payload", async () => {
    const transport: AppServerTransport = {
      request: vi.fn().mockResolvedValue({
        thread: {
          id: "thread-1",
          turns: [],
          requests: []
        }
      }),
      close: vi.fn().mockResolvedValue(undefined)
    };

    const client = new AppServerClient(transport);
    await client.resumeThread("thread-1");

    expect(transport.request).toHaveBeenCalledWith("thread/resume", {
      threadId: "thread-1",
      persistExtendedHistory: true
    });
  });
});

describe("AppServerClient.turn controls", () => {
  it("starts a turn with text input", async () => {
    const transport: AppServerTransport = {
      request: vi.fn().mockResolvedValue({}),
      close: vi.fn().mockResolvedValue(undefined)
    };

    const client = new AppServerClient(transport);
    await client.startTurn({
      threadId: "thread-1",
      input: [{ type: "text", text: "hello from turn start" }],
      attachments: []
    });

    expect(transport.request).toHaveBeenCalledWith(
      "turn/start",
      expect.objectContaining({
        threadId: "thread-1"
      })
    );
  });

  it("steers an active turn", async () => {
    const transport: AppServerTransport = {
      request: vi.fn().mockResolvedValue({}),
      close: vi.fn().mockResolvedValue(undefined)
    };

    const client = new AppServerClient(transport);
    await client.steerTurn({
      threadId: "thread-1",
      expectedTurnId: "turn-1",
      input: [{ type: "text", text: "continue with this approach" }]
    });

    expect(transport.request).toHaveBeenCalledWith("turn/steer", {
      threadId: "thread-1",
      expectedTurnId: "turn-1",
      input: [{ type: "text", text: "continue with this approach" }]
    });
  });

  it("interrupts a specific turn", async () => {
    const transport: AppServerTransport = {
      request: vi.fn().mockResolvedValue({}),
      close: vi.fn().mockResolvedValue(undefined)
    };

    const client = new AppServerClient(transport);
    await client.interruptTurn("thread-1", "turn-2");

    expect(transport.request).toHaveBeenCalledWith("turn/interrupt", {
      threadId: "thread-1",
      turnId: "turn-2"
    });
  });
});

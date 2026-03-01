import { describe, expect, it, vi } from "vitest";
import { AppServerClient } from "../src/app-server-client.js";
import type { AppServerTransport } from "../src/app-server-transport.js";

const START_THREAD_RESPONSE = {
  thread: {
    id: "thread-1",
    preview: "New thread",
    createdAt: 1,
    updatedAt: 1,
    source: "opencode",
  },
  model: "gpt-test",
  modelProvider: "openai",
  cwd: "/tmp/project",
  approvalPolicy: "never",
  sandbox: "danger-full-access",
  reasoningEffort: null,
};

describe("AppServerClient.startThread", () => {
  it("sets ephemeral to false when it is not provided", async () => {
    const transport: AppServerTransport = {
      request: vi.fn().mockResolvedValue(START_THREAD_RESPONSE),
      respond: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const client = new AppServerClient(transport);
    await client.startThread({
      cwd: "/tmp/project",
    });

    expect(transport.request).toHaveBeenCalledWith("thread/start", {
      cwd: "/tmp/project",
      ephemeral: false,
    });
  });

  it("keeps explicit ephemeral=true", async () => {
    const transport: AppServerTransport = {
      request: vi.fn().mockResolvedValue(START_THREAD_RESPONSE),
      respond: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const client = new AppServerClient(transport);
    await client.startThread({
      cwd: "/tmp/project",
      ephemeral: true,
    });

    expect(transport.request).toHaveBeenCalledWith("thread/start", {
      cwd: "/tmp/project",
      ephemeral: true,
    });
  });
});

describe("AppServerClient.sendUserMessage", () => {
  it("sends the expected request payload", async () => {
    const transport: AppServerTransport = {
      request: vi.fn().mockResolvedValue({}),
      respond: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined)
    };

    const client = new AppServerClient(transport);
    await client.sendUserMessage("thread-1", "hello");

    expect(transport.request).toHaveBeenCalledWith("turn/start", {
      threadId: "thread-1",
      input: [
        {
          type: "text",
          text: "hello"
        }
      ],
      attachments: []
    });
  });

  it("accepts success response from turn/start", async () => {
    const transport: AppServerTransport = {
      request: vi.fn().mockResolvedValue({ ok: true }),
      respond: vi.fn().mockResolvedValue(undefined),
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
      respond: vi.fn().mockResolvedValue(undefined),
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
      respond: vi.fn().mockResolvedValue(undefined),
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
      respond: vi.fn().mockResolvedValue(undefined),
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
      respond: vi.fn().mockResolvedValue(undefined),
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

describe("AppServerClient.submitUserInput", () => {
  it("responds to server request id with the parsed payload", async () => {
    const transport: AppServerTransport = {
      request: vi.fn().mockResolvedValue({}),
      respond: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const client = new AppServerClient(transport);
    await client.submitUserInput(42, {
      decision: "accept",
    });

    expect(transport.respond).toHaveBeenCalledWith(42, {
      decision: "accept",
    });
  });
});

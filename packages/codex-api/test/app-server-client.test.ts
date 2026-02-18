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

  it("fails fast when response schema drifts", async () => {
    const transport: AppServerTransport = {
      request: vi.fn().mockResolvedValue({ ok: true }),
      close: vi.fn().mockResolvedValue(undefined)
    };

    const client = new AppServerClient(transport);
    await expect(client.sendUserMessage("thread-1", "hello")).rejects.toThrow(
      /AppServerSendUserMessageResponse/
    );
  });
});

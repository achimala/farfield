import { describe, expect, it } from "vitest";
import { parseJsonRpcIncomingMessage, parseJsonRpcResponse } from "../src/json-rpc.js";

describe("parseJsonRpcResponse", () => {
  it("accepts response without jsonrpc", () => {
    const parsed = parseJsonRpcResponse({
      id: 1,
      result: { ok: true }
    });

    expect(parsed.id).toBe(1);
    expect(parsed.result).toEqual({ ok: true });
  });

  it("accepts response with jsonrpc", () => {
    const parsed = parseJsonRpcResponse({
      jsonrpc: "2.0",
      id: 2,
      error: {
        code: -32600,
        message: "bad"
      }
    });

    expect(parsed.id).toBe(2);
    expect(parsed.error?.code).toBe(-32600);
  });

  it("rejects response missing both result and error", () => {
    expect(() =>
      parseJsonRpcResponse({
        id: 3
      })
    ).toThrowError(/result or error/i);
  });
});

describe("parseJsonRpcIncomingMessage", () => {
  it("accepts notification payload", () => {
    const parsed = parseJsonRpcIncomingMessage({
      jsonrpc: "2.0",
      method: "thread/updated",
      params: { threadId: "thread-1" }
    });

    expect(parsed.kind).toBe("notification");
    if (parsed.kind === "notification") {
      expect(parsed.value.method).toBe("thread/updated");
      expect(parsed.value.params).toEqual({ threadId: "thread-1" });
    }
  });

  it("accepts response payload", () => {
    const parsed = parseJsonRpcIncomingMessage({
      id: 7,
      result: { ok: true }
    });

    expect(parsed.kind).toBe("response");
    if (parsed.kind === "response") {
      expect(parsed.value.id).toBe(7);
      expect(parsed.value.result).toEqual({ ok: true });
    }
  });
});

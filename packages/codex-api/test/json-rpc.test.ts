import { describe, expect, it } from "vitest";
import { parseJsonRpcResponse } from "../src/json-rpc.js";

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

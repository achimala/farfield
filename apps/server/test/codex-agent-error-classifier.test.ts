import { describe, expect, it } from "vitest";
import { AppServerRpcError } from "@farfield/api";
import { isInvalidRequestAppServerRpcError } from "../src/agents/adapters/codex-agent.js";

describe("isInvalidRequestAppServerRpcError", () => {
  it("returns true for invalid-request rpc errors", () => {
    expect(
      isInvalidRequestAppServerRpcError(
        new AppServerRpcError(-32600, "conversation not found"),
      ),
    ).toBe(true);
    expect(
      isInvalidRequestAppServerRpcError(
        new AppServerRpcError(-32600, "thread not found"),
      ),
    ).toBe(true);
    expect(
      isInvalidRequestAppServerRpcError(
        new AppServerRpcError(-32600, "thread not loaded"),
      ),
    ).toBe(true);
    expect(
      isInvalidRequestAppServerRpcError(
        new AppServerRpcError(-32600, "ThReAd NoT FoUnD"),
      ),
    ).toBe(true);
  });

  it("returns false for other rpc errors", () => {
    expect(
      isInvalidRequestAppServerRpcError(
        new AppServerRpcError(-32603, "thread not found"),
      ),
    ).toBe(false);
    expect(
      isInvalidRequestAppServerRpcError(
        new AppServerRpcError(-32600, "validation failed"),
      ),
    ).toBe(true);
  });

  it("returns false for non-rpc errors", () => {
    expect(
      isInvalidRequestAppServerRpcError(new Error("thread not found")),
    ).toBe(false);
    expect(isInvalidRequestAppServerRpcError(null)).toBe(false);
  });
});

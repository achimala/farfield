import { describe, expect, it } from "vitest";
import { parseServerCliOptions } from "../src/agents/cli-options.js";

describe("server cli options", () => {
  it("defaults to codex when --agents is omitted", () => {
    const parsed = parseServerCliOptions([]);
    expect(parsed.agentIds).toEqual(["codex"]);
  });

  it("expands all to every known agent", () => {
    const parsed = parseServerCliOptions(["--agents=all"]);
    expect(parsed.agentIds).toEqual(["codex", "opencode"]);
  });

  it("keeps order and dedupes repeated agent ids", () => {
    const parsed = parseServerCliOptions([
      "--agents",
      "opencode,codex,opencode",
    ]);
    expect(parsed.agentIds).toEqual(["opencode", "codex"]);
  });

  it("rejects unknown agent ids", () => {
    expect(() => parseServerCliOptions(["--agents=foo"])).toThrowError(
      /Unknown agent id/,
    );
  });
});

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseIpcFrame, parseThreadStreamStateChangedBroadcast } from "../src/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureDir = path.join(__dirname, "fixtures", "sanitized");

const bannedPatterns = [/\/Users\//i, /anshu/i, /OpenRLM/i, /codextemp/i];

function isIpcFrameCandidate(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    record["type"] === "request" ||
    record["type"] === "response" ||
    record["type"] === "broadcast" ||
    record["type"] === "client-discovery-request" ||
    record["type"] === "client-discovery-response"
  );
}

describe("sanitized fixtures", () => {
  it("contain no sensitive strings and keep valid protocol structure", () => {
    const files = fs.readdirSync(fixtureDir).filter((name) => name.endsWith(".ndjson"));
    expect(files.length).toBeGreaterThan(0);

    for (const fileName of files) {
      const input = fs.readFileSync(path.join(fixtureDir, fileName), "utf8");
      const lines = input.split("\n").filter(Boolean);
      expect(lines.length).toBeGreaterThan(0);

      for (const line of lines) {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        const serialized = JSON.stringify(parsed);

        for (const pattern of bannedPatterns) {
          expect(serialized).not.toMatch(pattern);
        }

        if (parsed["type"] !== "history") {
          continue;
        }

        const payload = parsed["payload"];
        if (!isIpcFrameCandidate(payload)) {
          continue;
        }

        const frame = parseIpcFrame(payload);

        if (frame.type === "broadcast" && frame.method === "thread-stream-state-changed") {
          parseThreadStreamStateChangedBroadcast(frame);
        }
      }
    }
  });
});

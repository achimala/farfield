import { describe, expect, it } from "vitest";
import { prepareHistoryPayloadForStorage } from "../src/debug-history.js";

describe("prepareHistoryPayloadForStorage", () => {
  it("preserves small payloads without compaction", () => {
    const result = prepareHistoryPayloadForStorage({
      type: "broadcast",
      method: "ping",
      params: { ok: true },
    });

    expect(result.compacted).toBe(false);
    expect(JSON.parse(result.json)).toEqual({
      type: "broadcast",
      method: "ping",
      params: { ok: true },
    });
  });

  it("compacts thread-stream snapshots while keeping debug-critical fields", () => {
    const largeText = "x".repeat(2_000);
    const result = prepareHistoryPayloadForStorage({
      type: "broadcast",
      method: "thread-stream-state-changed",
      params: {
        conversationId: "thread-123",
        change: {
          type: "snapshot",
          conversationState: {
            id: "thread-123",
            turns: [
              {
                turnId: "turn-1",
                status: "completed",
                items: [
                  {
                    id: "item-1",
                    type: "userMessage",
                    content: [{ type: "text", text: largeText }],
                  },
                  {
                    id: "item-2",
                    type: "agentMessage",
                    phase: "commentary",
                    text: largeText,
                  },
                  {
                    id: "item-3",
                    type: "contextCompaction",
                  },
                ],
              },
            ],
            requests: [],
          },
        },
      },
    });

    const stored = JSON.parse(result.json);
    const turn = stored.params.change.conversationState.turns[0];

    expect(result.compacted).toBe(true);
    expect(turn.turnId).toBe("turn-1");
    expect(turn.itemCount).toBe(3);
    expect(turn.itemTypes).toEqual([
      "userMessage",
      "agentMessage",
      "contextCompaction",
    ]);
    expect(turn.items[1]).toMatchObject({
      id: "item-2",
      type: "agentMessage",
      phase: "commentary",
    });
    expect(turn.items[1].text).toContain("... [");
  });

  it("compacts thread-stream patches into a bounded preview", () => {
    const result = prepareHistoryPayloadForStorage({
      type: "broadcast",
      method: "thread-stream-state-changed",
      params: {
        conversationId: "thread-456",
        change: {
          type: "patches",
          patches: Array.from({ length: 40 }, (_, index) => ({
            op: "add",
            path: ["turns", 0, "items", index],
            value: {
              id: `item-${index}`,
              type: "agentMessage",
              text: "y".repeat(1_000),
            },
          })),
        },
      },
    });

    const stored = JSON.parse(result.json);
    expect(result.compacted).toBe(true);
    expect(stored.params.change.patchCount).toBe(40);
    expect(stored.params.change.patches).toHaveLength(24);
    expect(stored.params.change.truncatedPatchCount).toBe(16);
  });

  it("handles BigInt and undefined roots without throwing", () => {
    const bigintResult = prepareHistoryPayloadForStorage({
      type: "system",
      value: 42n,
    });
    const undefinedResult = prepareHistoryPayloadForStorage(undefined);

    expect(JSON.parse(bigintResult.json)).toEqual({
      type: "system",
      value: "42",
    });
    expect(undefinedResult.json).toBe("null");
  });

  it("falls back safely when payload contains circular references", () => {
    const payload: { type: string; self?: unknown } = {
      type: "system",
    };
    payload.self = payload;

    const result = prepareHistoryPayloadForStorage(payload);

    expect(JSON.parse(result.json)).toEqual({
      type: "system",
      self: "[Circular]",
    });
  });

  it("reports turnOffsetFromLatest relative to the latest retained turn", () => {
    const result = prepareHistoryPayloadForStorage({
      type: "broadcast",
      method: "thread-stream-state-changed",
      params: {
        conversationId: "thread-offsets",
        change: {
          type: "snapshot",
          conversationState: {
            id: "thread-offsets",
            turns: Array.from({ length: 20 }, (_, index) => ({
              turnId: `turn-${index}`,
              status: "completed",
              items: [],
            })),
            requests: [],
          },
        },
      },
    });

    const stored = JSON.parse(result.json);
    const retainedTurns = stored.params.change.conversationState.turns;

    expect(retainedTurns).toHaveLength(16);
    expect(retainedTurns[0]?.turnId).toBe("turn-4");
    expect(retainedTurns[0]?.turnOffsetFromLatest).toBe(15);
    expect(retainedTurns[15]?.turnId).toBe("turn-19");
    expect(retainedTurns[15]?.turnOffsetFromLatest).toBe(0);
  });
});

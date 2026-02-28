import { describe, expect, it } from "vitest";
import { parseThreadStreamStateChangedBroadcast } from "@farfield/protocol";
import { reduceThreadStreamEvents, ThreadStreamReductionError } from "../src/live-state.js";

describe("live-state reducer", () => {
  it("applies snapshot then patches", () => {
    const snapshotEvent = parseThreadStreamStateChangedBroadcast({
      type: "broadcast",
      method: "thread-stream-state-changed",
      sourceClientId: "client-a",
      version: 4,
      params: {
        conversationId: "thread-1",
        type: "thread-stream-state-changed",
        version: 4,
        change: {
          type: "snapshot",
          conversationState: {
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
          }
        }
      }
    });

    const patchEvent = parseThreadStreamStateChangedBroadcast({
      type: "broadcast",
      method: "thread-stream-state-changed",
      sourceClientId: "client-a",
      version: 4,
      params: {
        conversationId: "thread-1",
        type: "thread-stream-state-changed",
        version: 4,
        change: {
          type: "patches",
          patches: [
            {
              op: "replace",
              path: ["requests"],
              value: [
                {
                  method: "item/tool/requestUserInput",
                  id: 3,
                  params: {
                    threadId: "thread-1",
                    turnId: "turn-2",
                    itemId: "item-9",
                    questions: [
                      {
                        id: "q1",
                        header: "Header",
                        question: "Choose",
                        isOther: true,
                        isSecret: false,
                        options: [
                          {
                            label: "A",
                            description: "A desc"
                          }
                        ]
                      }
                    ]
                  }
                }
              ]
            }
          ]
        }
      }
    });

    const state = reduceThreadStreamEvents([snapshotEvent, patchEvent]);
    const thread = state.get("thread-1");

    expect(thread?.conversationState?.requests.length).toBe(1);
  });

  it("throws when patches arrive before snapshot", () => {
    const patchEvent = parseThreadStreamStateChangedBroadcast({
      type: "broadcast",
      method: "thread-stream-state-changed",
      sourceClientId: "client-a",
      version: 4,
      params: {
        conversationId: "thread-2",
        type: "thread-stream-state-changed",
        version: 4,
        change: {
          type: "patches",
          patches: [
            {
              op: "add",
              path: ["turns", 0],
              value: {
                status: "inProgress",
                items: []
              }
            }
          ]
        }
      }
    });

    const snapshotEvent = parseThreadStreamStateChangedBroadcast({
      type: "broadcast",
      method: "thread-stream-state-changed",
      sourceClientId: "client-a",
      version: 4,
      params: {
        conversationId: "thread-2",
        type: "thread-stream-state-changed",
        version: 4,
        change: {
          type: "snapshot",
          conversationState: {
            id: "thread-2",
            turns: [],
            requests: []
          }
        }
      }
    });

    expect(() => reduceThreadStreamEvents([patchEvent, snapshotEvent])).toThrow(
      "patch event arrived before snapshot"
    );
  });

  it("throws reduction error with raw payload details when patch introduces invalid item type", () => {
    const snapshotEvent = parseThreadStreamStateChangedBroadcast({
      type: "broadcast",
      method: "thread-stream-state-changed",
      sourceClientId: "client-a",
      version: 4,
      params: {
        conversationId: "thread-3",
        type: "thread-stream-state-changed",
        version: 4,
        change: {
          type: "snapshot",
          conversationState: {
            id: "thread-3",
            turns: [
              {
                status: "completed",
                items: [
                  {
                    id: "item-1",
                    type: "userMessage",
                    content: [{ type: "text", text: "hello" }]
                  }
                ]
              }
            ],
            requests: []
          }
        }
      }
    });

    const patchEvent = parseThreadStreamStateChangedBroadcast({
      type: "broadcast",
      method: "thread-stream-state-changed",
      sourceClientId: "client-a",
      version: 4,
      params: {
        conversationId: "thread-3",
        type: "thread-stream-state-changed",
        version: 4,
        change: {
          type: "patches",
          patches: [
            {
              op: "replace",
              path: ["turns", 0, "items", 0],
              value: {
                id: "item-2",
                type: "newUnknownItemType"
              }
            }
          ]
        }
      }
    });

    let captured: unknown;
    try {
      reduceThreadStreamEvents([snapshotEvent, patchEvent]);
    } catch (error) {
      captured = error;
    }

    expect(captured).toBeInstanceOf(ThreadStreamReductionError);
    const reductionError = captured as ThreadStreamReductionError;
    expect(reductionError.details.threadId).toBe("thread-3");
    expect(reductionError.details.eventIndex).toBe(1);
    expect(reductionError.details.patchIndex).toBe(0);
    expect(reductionError.details.event.params.conversationId).toBe("thread-3");
    expect(reductionError.details.patch.op).toBe("replace");
  });
});

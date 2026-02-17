import { describe, expect, it } from "vitest";
import { parseThreadStreamStateChangedBroadcast } from "@codex-monitor/codex-protocol";
import { reduceThreadStreamEvents } from "../src/live-state.js";

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
});

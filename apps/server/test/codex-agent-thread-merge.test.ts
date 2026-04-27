import { describe, expect, it } from "vitest";
import { parseThreadConversationState } from "@farfield/protocol";
import { mergeThreadConversationStates } from "../src/agents/adapters/codex-agent.js";

describe("mergeThreadConversationStates", () => {
  it("keeps richer stream items while applying official thread metadata", () => {
    const currentThread = parseThreadConversationState({
      id: "thread-1",
      title: "Desktop title",
      latestModel: "desktop-model",
      status: { type: "active", activeFlags: ["waitingOnApproval"] },
      turns: [
        {
          turnId: "turn-1",
          status: "inProgress",
          items: [
            {
              id: "item-user-1",
              type: "userMessage",
              content: [{ type: "text", text: "Run tests" }],
            },
            {
              id: "item-cmd-1",
              type: "commandExecution",
              command: "bun test",
              aggregatedOutput: "running",
              parsedCmd: [],
              cwd: "/tmp/project",
              status: "inProgress",
            },
          ],
        },
      ],
      requests: [
        {
          method: "item/commandExecution/requestApproval",
          id: "approval-1",
          params: {
            threadId: "thread-1",
            turnId: "turn-1",
            itemId: "item-cmd-1",
            command: "bun test",
          },
          completed: false,
        },
      ],
    });

    const nextReadThread = parseThreadConversationState({
      id: "thread-1",
      title: "Official title",
      latestModel: "gpt-5.3-codex",
      status: { type: "idle" },
      turns: [
        {
          turnId: "turn-1",
          status: "completed",
          items: [
            {
              id: "item-user-1",
              type: "userMessage",
              content: [{ type: "text", text: "Run tests" }],
            },
          ],
        },
      ],
      requests: [],
    });

    const merged = mergeThreadConversationStates(currentThread, nextReadThread);
    const mergedTurn = merged.turns[0];

    expect(merged.title).toBe("Official title");
    expect(merged.latestModel).toBe("gpt-5.3-codex");
    expect(merged.status).toEqual({ type: "idle" });
    expect(merged.requests).toHaveLength(1);
    expect(mergedTurn?.status).toBe("completed");
    expect(mergedTurn?.items.map((item) => item.type)).toEqual([
      "userMessage",
      "commandExecution",
    ]);
  });

  it("dedupes stream turns and synthetic message item ids against read-thread ids", () => {
    const currentThread = parseThreadConversationState({
      id: "thread-1",
      turns: [
        {
          id: "turn-1",
          status: "completed",
          items: [
            {
              id: "item-1",
              type: "userMessage",
              content: [{ type: "text", text: "Hello" }],
            },
            {
              id: "item-2",
              type: "agentMessage",
              text: "Hi",
            },
          ],
        },
        {
          id: "turn-1",
          status: "completed",
          items: [
            {
              id: "item-3",
              type: "userMessage",
              content: [{ type: "text", text: "Hello" }],
            },
            {
              id: "item-4",
              type: "agentMessage",
              text: "Hi",
            },
          ],
        },
      ],
      requests: [],
    });

    const nextReadThread = parseThreadConversationState({
      id: "thread-1",
      turns: [
        {
          id: "turn-1",
          turnId: "turn-1",
          status: "completed",
          items: [
            {
              id: "real-user-1",
              type: "userMessage",
              content: [{ type: "text", text: "Hello" }],
            },
            {
              id: "real-agent-1",
              type: "agentMessage",
              text: "Hi",
            },
          ],
        },
      ],
      requests: [],
    });

    const merged = mergeThreadConversationStates(currentThread, nextReadThread);

    expect(merged.turns).toHaveLength(1);
    expect(merged.turns[0]?.items).toHaveLength(2);
    expect(merged.turns[0]?.items.map((item) => item.id)).toEqual([
      "real-user-1",
      "real-agent-1",
    ]);
  });

  it("dedupes duplicate turns already present in read-thread state", () => {
    const currentThread = parseThreadConversationState({
      id: "thread-1",
      turns: [],
      requests: [],
    });

    const nextReadThread = parseThreadConversationState({
      id: "thread-1",
      turns: [
        {
          id: "turn-1",
          turnId: "turn-1",
          status: "completed",
          items: [
            {
              id: "real-user-1",
              type: "userMessage",
              content: [{ type: "text", text: "Hello" }],
            },
            {
              id: "real-agent-1",
              type: "agentMessage",
              text: "Hi",
            },
          ],
        },
        {
          id: "turn-1",
          status: "completed",
          items: [
            {
              id: "item-1",
              type: "userMessage",
              content: [{ type: "text", text: "Hello" }],
            },
            {
              id: "item-2",
              type: "agentMessage",
              text: "Hi",
            },
          ],
        },
      ],
      requests: [],
    });

    const merged = mergeThreadConversationStates(currentThread, nextReadThread);

    expect(merged.turns).toHaveLength(1);
    expect(merged.turns[0]?.items.map((item) => item.id)).toEqual([
      "real-user-1",
      "real-agent-1",
    ]);
  });

  it("orders unmatched read-thread turns by start time", () => {
    const currentThread = parseThreadConversationState({
      id: "thread-1",
      turns: [
        {
          id: "turn-a",
          turnStartedAtMs: 1000,
          status: "completed",
          items: [
            {
              id: "item-a",
              type: "userMessage",
              content: [{ type: "text", text: "First" }],
            },
          ],
        },
        {
          id: "turn-c",
          turnStartedAtMs: 3000,
          status: "completed",
          items: [
            {
              id: "item-c",
              type: "userMessage",
              content: [{ type: "text", text: "Third" }],
            },
          ],
        },
      ],
      requests: [],
    });

    const nextReadThread = parseThreadConversationState({
      id: "thread-1",
      turns: [
        {
          id: "turn-b",
          turnStartedAtMs: 2000,
          status: "completed",
          items: [
            {
              id: "item-b",
              type: "userMessage",
              content: [{ type: "text", text: "Second" }],
            },
          ],
        },
      ],
      requests: [],
    });

    const merged = mergeThreadConversationStates(currentThread, nextReadThread);

    expect(merged.turns.map((turn) => turn.id)).toEqual([
      "turn-a",
      "turn-b",
      "turn-c",
    ]);
  });
});

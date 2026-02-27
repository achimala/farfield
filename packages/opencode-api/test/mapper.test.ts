import { describe, expect, it } from "vitest";
import type {
  AssistantMessage,
  Event,
  Message,
  Part,
  Session,
  ToolState,
  UserMessage
} from "@opencode-ai/sdk";
import {
  OPENCODE_EVENT_TYPES,
  OPENCODE_PART_TYPES,
  type OpenCodeEventType,
  type OpenCodePartType
} from "../src/generated/OpenCodeManifest.js";
import {
  mapOpenCodeEventToSsePayload,
  messagesToTurns,
  partToTurnItem,
  sessionToConversationState,
  sessionToThreadListItem
} from "../src/mapper.js";

function makeSession(overrides?: Partial<Session>): Session {
  return {
    id: "sess-1",
    projectID: "project-1",
    directory: "/tmp/project",
    title: "Test Session",
    version: "1",
    time: {
      created: 1700000000,
      updated: 1700001000
    },
    ...overrides
  };
}

function makeUserMessage(id: string): UserMessage {
  return {
    id,
    role: "user",
    sessionID: "sess-1",
    parentID: "",
    agent: "codex",
    model: {
      providerID: "openai",
      modelID: "gpt-5.3-codex"
    },
    time: {
      created: 1700000100
    }
  };
}

function makeAssistantMessage(id: string, parentID: string): AssistantMessage {
  return {
    id,
    role: "assistant",
    sessionID: "sess-1",
    parentID,
    providerID: "anthropic",
    modelID: "claude-sonnet",
    mode: "default",
    path: {
      cwd: "/tmp/project",
      root: "/tmp"
    },
    cost: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: {
        read: 0,
        write: 0
      }
    },
    time: {
      created: 1700000200
    },
    finish: "stop"
  };
}

function makeToolState(status: ToolState["status"]): ToolState {
  switch (status) {
    case "pending":
      return {
        status,
        input: {
          command: "echo pending"
        },
        raw: "raw"
      };
    case "running":
      return {
        status,
        input: {
          command: "echo running"
        },
        time: {
          start: 1700000100
        }
      };
    case "completed":
      return {
        status,
        input: {
          command: "echo done",
          cwd: "/tmp/project",
          file_path: "/tmp/project/file.ts"
        },
        output: "done",
        title: "completed",
        metadata: {
          exit_code: 0
        },
        time: {
          start: 1700000100,
          end: 1700000200
        }
      };
    case "error":
      return {
        status,
        input: {
          command: "echo fail"
        },
        error: "failed",
        metadata: {
          exit_code: 1
        },
        time: {
          start: 1700000100,
          end: 1700000200
        }
      };
  }
}

function makePart(type: OpenCodePartType): Part {
  switch (type) {
    case "agent":
      return {
        id: "part-agent",
        sessionID: "sess-1",
        messageID: "msg-1",
        type,
        name: "helper-agent"
      };
    case "compaction":
      return {
        id: "part-compaction",
        sessionID: "sess-1",
        messageID: "msg-1",
        type,
        auto: true
      };
    case "file":
      return {
        id: "part-file",
        sessionID: "sess-1",
        messageID: "msg-1",
        type,
        mime: "text/plain",
        url: "/tmp/project/file.ts"
      };
    case "patch":
      return {
        id: "part-patch",
        sessionID: "sess-1",
        messageID: "msg-1",
        type,
        hash: "hash",
        files: ["/tmp/project/file.ts"]
      };
    case "reasoning":
      return {
        id: "part-reasoning",
        sessionID: "sess-1",
        messageID: "msg-1",
        type,
        text: "thinking",
        time: {
          start: 1700000100
        }
      };
    case "retry":
      return {
        id: "part-retry",
        sessionID: "sess-1",
        messageID: "msg-1",
        type,
        attempt: 1,
        error: {
          name: "APIError",
          data: {
            message: "retry failed",
            isRetryable: false
          }
        },
        time: {
          created: 1700000100
        }
      };
    case "snapshot":
      return {
        id: "part-snapshot",
        sessionID: "sess-1",
        messageID: "msg-1",
        type,
        snapshot: "snapshot"
      };
    case "step-finish":
      return {
        id: "part-step-finish",
        sessionID: "sess-1",
        messageID: "msg-1",
        type,
        reason: "completed",
        cost: 0,
        tokens: {
          input: 0,
          output: 0,
          reasoning: 0,
          cache: {
            read: 0,
            write: 0
          }
        }
      };
    case "step-start":
      return {
        id: "part-step-start",
        sessionID: "sess-1",
        messageID: "msg-1",
        type
      };
    case "subtask":
      return {
        id: "part-subtask",
        sessionID: "sess-1",
        messageID: "msg-1",
        type,
        prompt: "Do X",
        description: "Task",
        agent: "helper"
      };
    case "text":
      return {
        id: "part-text",
        sessionID: "sess-1",
        messageID: "msg-1",
        type,
        text: "hello"
      };
    case "tool":
      return {
        id: "part-tool",
        sessionID: "sess-1",
        messageID: "msg-1",
        type,
        callID: "call-1",
        tool: "bash",
        state: makeToolState("completed")
      };
  }
}

function makeEvent(type: OpenCodeEventType): Event {
  switch (type) {
    case "command.executed":
      return {
        type,
        properties: {
          name: "cmd",
          sessionID: "sess-1",
          arguments: "",
          messageID: "msg-1"
        }
      };
    case "message.part.removed":
      return {
        type,
        properties: {
          sessionID: "sess-1",
          messageID: "msg-1",
          partID: "part-1"
        }
      };
    case "message.part.updated":
      return {
        type,
        properties: {
          part: makePart("text")
        }
      };
    case "message.removed":
      return {
        type,
        properties: {
          sessionID: "sess-1",
          messageID: "msg-1"
        }
      };
    case "message.updated":
      return {
        type,
        properties: {
          info: makeUserMessage("msg-1")
        }
      };
    case "permission.replied":
      return {
        type,
        properties: {
          sessionID: "sess-1",
          permissionID: "perm-1",
          response: "approve"
        }
      };
    case "permission.updated":
      return {
        type,
        properties: {
          id: "perm-1",
          type: "approval",
          sessionID: "sess-1",
          messageID: "msg-1",
          title: "Permission",
          metadata: {},
          time: {
            created: 1700000100
          }
        }
      };
    case "session.compacted":
      return {
        type,
        properties: {
          sessionID: "sess-1"
        }
      };
    case "session.created":
    case "session.deleted":
    case "session.updated":
      return {
        type,
        properties: {
          info: makeSession()
        }
      };
    case "session.diff":
      return {
        type,
        properties: {
          sessionID: "sess-1",
          diff: []
        }
      };
    case "session.error":
      return {
        type,
        properties: {
          sessionID: "sess-1"
        }
      };
    case "session.idle":
      return {
        type,
        properties: {
          sessionID: "sess-1"
        }
      };
    case "session.status":
      return {
        type,
        properties: {
          sessionID: "sess-1",
          status: {
            type: "busy"
          }
        }
      };
    case "todo.updated":
      return {
        type,
        properties: {
          sessionID: "sess-1",
          todos: []
        }
      };
    default:
      return {
        type,
        properties: {}
      } as Event;
  }
}

describe("sessionToThreadListItem", () => {
  it("maps session fields correctly", () => {
    const result = sessionToThreadListItem(makeSession());

    expect(result.id).toBe("sess-1");
    expect(result.preview).toBe("Test Session");
    expect(result.title).toBe("Test Session");
    expect(result.createdAt).toBe(1700000000);
    expect(result.updatedAt).toBe(1700001000);
    expect(result.cwd).toBe("/tmp/project");
    expect(result.source).toBe("opencode");
  });

  it("normalizes millisecond unix timestamps to seconds", () => {
    const result = sessionToThreadListItem(
      makeSession({
        time: {
          created: 1771181073448,
          updated: 1771182751310
        }
      })
    );

    expect(result.createdAt).toBe(1771181073);
    expect(result.updatedAt).toBe(1771182751);
  });
});

describe("messagesToTurns", () => {
  it("pairs user and assistant messages into turns", () => {
    const userMessage = makeUserMessage("u1");
    const assistantMessage = makeAssistantMessage("a1", "u1");
    const messages: Message[] = [userMessage, assistantMessage];

    const partsByMessage = new Map<string, Part[]>();
    partsByMessage.set("u1", [makePart("text")]);
    partsByMessage.set("a1", [makePart("text"), makePart("tool")]);

    const turns = messagesToTurns(messages, partsByMessage);

    expect(turns).toHaveLength(1);
    expect(turns[0].items[0].type).toBe("userMessage");
    expect(turns[0].items[1].type).toBe("agentMessage");
    expect(turns[0].status).toBe("completed");
  });
});

describe("partToTurnItem", () => {
  it("maps every SDK part type", () => {
    for (const partType of OPENCODE_PART_TYPES) {
      const mapped = partToTurnItem(makePart(partType));
      expect(mapped.id.length).toBeGreaterThan(0);
      expect(typeof mapped.type).toBe("string");
    }
  });
});

describe("mapOpenCodeEventToSsePayload", () => {
  it("maps every SDK event type", () => {
    for (const eventType of OPENCODE_EVENT_TYPES) {
      const payload = mapOpenCodeEventToSsePayload(makeEvent(eventType), "sess-1");
      expect(payload.type).toBe("opencode-event");
      expect(payload.eventType).toBe(eventType);
      expect(payload.sessionId).toBe("sess-1");
    }
  });

  it("marks non-matching session events as not relevant", () => {
    const payload = mapOpenCodeEventToSsePayload(
      {
        type: "message.updated",
        properties: {
          info: {
            ...makeUserMessage("msg-1"),
            sessionID: "sess-other"
          }
        }
      },
      "sess-1"
    );

    expect(payload.relatedSessionId).toBe("sess-other");
    expect(payload.relevantToSession).toBe(false);
  });
});

describe("sessionToConversationState", () => {
  it("builds full conversation state", () => {
    const userMessage = makeUserMessage("u1");
    const assistantMessage = makeAssistantMessage("a1", "u1");
    const messages: Message[] = [userMessage, assistantMessage];

    const partsByMessage = new Map<string, Part[]>();
    partsByMessage.set("u1", [makePart("text")]);
    partsByMessage.set("a1", [makePart("text")]);

    const state = sessionToConversationState(makeSession(), messages, partsByMessage);

    expect(state.id).toBe("sess-1");
    expect(state.turns).toHaveLength(1);
    expect(state.requests).toEqual([]);
    expect(state.title).toBe("Test Session");
    expect(state.latestModel).toBe("anthropic/claude-sonnet");
    expect(state.source).toBe("opencode");
  });

  it("normalizes conversation timestamps from milliseconds to seconds", () => {
    const state = sessionToConversationState(
      makeSession({
        time: {
          created: 1771181073448,
          updated: 1771182751310
        }
      }),
      [],
      new Map<string, Part[]>()
    );

    expect(state.createdAt).toBe(1771181073);
    expect(state.updatedAt).toBe(1771182751);
  });
});

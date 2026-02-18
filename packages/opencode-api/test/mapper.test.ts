import { describe, expect, it } from "vitest";
import {
  sessionToThreadListItem,
  sessionToConversationState,
  messagesToTurns,
  partToTurnItem
} from "../src/mapper.js";
import type {
  Session,
  UserMessage,
  AssistantMessage,
  TextPart,
  ToolPart,
  ReasoningPart,
  Part,
  Message
} from "@opencode-ai/sdk";

function makeSession(overrides?: Partial<Session>): Session {
  return {
    id: "sess-1",
    title: "Test Session",
    directory: "/tmp/project",
    time: { created: 1700000000, updated: 1700001000 },
    ...overrides
  } as Session;
}

function makeUserMessage(id: string, text: string): UserMessage {
  return {
    id,
    role: "user",
    sessionID: "sess-1",
    parentID: "",
    time: { created: 1700000100, updated: 1700000100 }
  } as UserMessage;
}

function makeAssistantMessage(id: string, parentID: string): AssistantMessage {
  return {
    id,
    role: "assistant",
    sessionID: "sess-1",
    parentID,
    providerID: "anthropic",
    modelID: "claude-sonnet",
    time: { created: 1700000200, updated: 1700000200 }
  } as AssistantMessage;
}

function makeTextPart(id: string, text: string): TextPart {
  return { id, type: "text", text } as TextPart;
}

function makeReasoningPart(id: string, text: string): ReasoningPart {
  return { id, type: "reasoning", text } as ReasoningPart;
}

function makeToolPart(
  id: string,
  tool: string,
  state: { status: string; input: Record<string, unknown>; output?: string }
): ToolPart {
  return {
    id,
    type: "tool",
    tool,
    state: {
      status: state.status,
      input: state.input,
      output: state.output ?? null,
      time: { start: 1700000100, end: 1700000200 }
    }
  } as ToolPart;
}

describe("sessionToThreadListItem", () => {
  it("maps session fields correctly", () => {
    const session = makeSession();
    const result = sessionToThreadListItem(session);

    expect(result.id).toBe("sess-1");
    expect(result.preview).toBe("Test Session");
    expect(result.createdAt).toBe(1700000000);
    expect(result.updatedAt).toBe(1700001000);
    expect(result.cwd).toBe("/tmp/project");
    expect(result.source).toBe("opencode");
  });

  it("uses (untitled) for sessions without title", () => {
    const session = makeSession({ title: "" });
    const result = sessionToThreadListItem(session);
    expect(result.preview).toBe("(untitled)");
  });
});

describe("messagesToTurns", () => {
  it("pairs user and assistant messages into turns", () => {
    const userMsg = makeUserMessage("u1", "hello");
    const assistantMsg = makeAssistantMessage("a1", "u1");
    const messages: Message[] = [userMsg, assistantMsg];

    const partsByMessage = new Map<string, Part[]>();
    partsByMessage.set("u1", [makeTextPart("p1", "hello")]);
    partsByMessage.set("a1", [makeTextPart("p2", "hi there")]);

    const turns = messagesToTurns(messages, partsByMessage);

    expect(turns).toHaveLength(1);
    expect(turns[0].items).toHaveLength(2);
    expect(turns[0].items[0].type).toBe("userMessage");
    expect(turns[0].items[1].type).toBe("agentMessage");
  });

  it("creates a turn for user message without assistant response", () => {
    const userMsg = makeUserMessage("u1", "hello");
    const messages: Message[] = [userMsg];

    const partsByMessage = new Map<string, Part[]>();
    partsByMessage.set("u1", [makeTextPart("p1", "hello")]);

    const turns = messagesToTurns(messages, partsByMessage);

    expect(turns).toHaveLength(1);
    expect(turns[0].items).toHaveLength(1);
    expect(turns[0].items[0].type).toBe("userMessage");
    expect(turns[0].status).toBe("pending");
  });
});

describe("partToTurnItem", () => {
  it("maps text part to agentMessage", () => {
    const part = makeTextPart("p1", "Hello world");
    const result = partToTurnItem(part);

    expect(result).not.toBeNull();
    expect(result!.type).toBe("agentMessage");
    if (result!.type === "agentMessage") {
      expect(result!.text).toBe("Hello world");
    }
  });

  it("maps reasoning part", () => {
    const part = makeReasoningPart("p1", "thinking about it...");
    const result = partToTurnItem(part);

    expect(result).not.toBeNull();
    expect(result!.type).toBe("reasoning");
    if (result!.type === "reasoning") {
      expect(result!.text).toBe("thinking about it...");
    }
  });

  it("maps bash tool part to commandExecution", () => {
    const part = makeToolPart("p1", "bash", {
      status: "completed",
      input: { command: "ls -la", cwd: "/tmp" },
      output: "file1.txt\nfile2.txt"
    });
    const result = partToTurnItem(part);

    expect(result).not.toBeNull();
    expect(result!.type).toBe("commandExecution");
    if (result!.type === "commandExecution") {
      expect(result!.command).toBe("ls -la");
      expect(result!.cwd).toBe("/tmp");
      expect(result!.aggregatedOutput).toBe("file1.txt\nfile2.txt");
    }
  });

  it("maps write tool part to fileChange", () => {
    const part = makeToolPart("p1", "write", {
      status: "completed",
      input: { file_path: "/tmp/foo.ts" },
      output: "wrote 50 lines"
    });
    const result = partToTurnItem(part);

    expect(result).not.toBeNull();
    expect(result!.type).toBe("fileChange");
    if (result!.type === "fileChange") {
      expect(result!.changes).toHaveLength(1);
      expect(result!.changes[0].path).toBe("/tmp/foo.ts");
      expect(result!.changes[0].kind.type).toBe("created");
    }
  });

  it("maps edit tool part to fileChange with modified kind", () => {
    const part = makeToolPart("p1", "edit", {
      status: "completed",
      input: { path: "/tmp/bar.ts" }
    });
    const result = partToTurnItem(part);

    expect(result).not.toBeNull();
    expect(result!.type).toBe("fileChange");
    if (result!.type === "fileChange") {
      expect(result!.changes[0].kind.type).toBe("modified");
    }
  });
});

describe("sessionToConversationState", () => {
  it("builds full conversation state", () => {
    const session = makeSession();
    const userMsg = makeUserMessage("u1", "hello");
    const assistantMsg = makeAssistantMessage("a1", "u1");
    const messages: Message[] = [userMsg, assistantMsg];

    const partsByMessage = new Map<string, Part[]>();
    partsByMessage.set("u1", [makeTextPart("p1", "hello")]);
    partsByMessage.set("a1", [makeTextPart("p2", "hi there")]);

    const state = sessionToConversationState(session, messages, partsByMessage);

    expect(state.id).toBe("sess-1");
    expect(state.turns).toHaveLength(1);
    expect(state.requests).toEqual([]);
    expect(state.title).toBe("Test Session");
    expect(state.latestModel).toBe("anthropic/claude-sonnet");
    expect(state.source).toBe("opencode");
  });
});

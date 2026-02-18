import type {
  Session,
  Message,
  UserMessage,
  AssistantMessage,
  Part,
  TextPart,
  ToolPart,
  ReasoningPart,
  FilePart,
  ToolState,
  EventMessageUpdated,
  EventMessagePartUpdated,
  EventSessionUpdated,
  EventSessionStatus,
  EventPermissionUpdated
} from "@opencode-ai/sdk";

/**
 * Mapped thread list item, matching the shape of AppServerThreadListItemSchema.
 */
export interface MappedThreadListItem {
  id: string;
  preview: string;
  createdAt: number;
  updatedAt: number;
  cwd?: string;
  source: "opencode";
}

/**
 * Mapped turn item, matching the shape of TurnItemSchema discriminated union.
 */
export type MappedTurnItem =
  | { id: string; type: "userMessage"; content: Array<{ type: "text"; text: string }> }
  | { id: string; type: "agentMessage"; text: string }
  | { id: string; type: "reasoning"; text: string; summary?: string[] }
  | {
      id: string;
      type: "commandExecution";
      command: string;
      status: string;
      cwd?: string;
      aggregatedOutput?: string | null;
      exitCode?: number | null;
      durationMs?: number | null;
    }
  | {
      id: string;
      type: "fileChange";
      changes: Array<{ path: string; kind: { type: string }; diff?: string }>;
      status: string;
    };

/**
 * Mapped turn, matching the shape of ThreadTurnSchema.
 */
export interface MappedTurn {
  turnId: string | null;
  id: string;
  status: string;
  turnStartedAtMs: number | null;
  finalAssistantStartedAtMs: number | null;
  error: unknown | null;
  diff: unknown | null;
  items: MappedTurnItem[];
}

/**
 * Mapped thread conversation state, matching ThreadConversationStateSchema.
 */
export interface MappedThreadConversationState {
  id: string;
  turns: MappedTurn[];
  requests: never[];
  createdAt: number;
  updatedAt: number;
  title: string | null;
  latestModel: string | null;
  cwd?: string;
  source: "opencode";
}

export function sessionToThreadListItem(session: Session): MappedThreadListItem {
  return {
    id: session.id,
    preview: session.title || "(untitled)",
    createdAt: session.time.created,
    updatedAt: session.time.updated,
    cwd: session.directory,
    source: "opencode"
  };
}

export function sessionToConversationState(
  session: Session,
  messages: Message[],
  partsByMessage: Map<string, Part[]>
): MappedThreadConversationState {
  const turns = messagesToTurns(messages, partsByMessage);

  const lastAssistant = messages.filter(
    (m): m is AssistantMessage => m.role === "assistant"
  ).at(-1);

  return {
    id: session.id,
    turns,
    requests: [],
    createdAt: session.time.created,
    updatedAt: session.time.updated,
    title: session.title || null,
    latestModel: lastAssistant
      ? `${lastAssistant.providerID}/${lastAssistant.modelID}`
      : null,
    cwd: session.directory,
    source: "opencode"
  };
}

/**
 * Reconstruct turns from OpenCode messages.
 *
 * OpenCode has no first-class "turn" concept. A turn is a user message
 * paired with the assistant message that responds to it (linked via parentID).
 */
export function messagesToTurns(
  messages: Message[],
  partsByMessage: Map<string, Part[]>
): MappedTurn[] {
  const turns: MappedTurn[] = [];
  const assistantByParent = new Map<string, AssistantMessage>();

  for (const msg of messages) {
    if (msg.role === "assistant") {
      assistantByParent.set(msg.parentID, msg);
    }
  }

  for (const msg of messages) {
    if (msg.role !== "user") {
      continue;
    }

    const userMsg = msg as UserMessage;
    const assistantMsg = assistantByParent.get(userMsg.id) ?? null;
    const items: MappedTurnItem[] = [];

    const userParts = partsByMessage.get(userMsg.id) ?? [];
    const userTextParts = userParts.filter(
      (p): p is TextPart => p.type === "text"
    );

    if (userTextParts.length > 0) {
      items.push({
        id: `${userMsg.id}-input`,
        type: "userMessage",
        content: userTextParts.map((p) => ({ type: "text" as const, text: p.text }))
      });
    }

    if (assistantMsg) {
      const assistantParts = partsByMessage.get(assistantMsg.id) ?? [];
      for (const part of assistantParts) {
        const mapped = partToTurnItem(part);
        if (mapped) {
          items.push(mapped);
        }
      }
    }

    const isCompleted = assistantMsg?.finish === "stop" || assistantMsg?.finish === "length";
    const hasError = assistantMsg?.error != null;

    turns.push({
      turnId: assistantMsg?.id ?? null,
      id: userMsg.id,
      status: hasError ? "error" : isCompleted ? "completed" : assistantMsg ? "running" : "pending",
      turnStartedAtMs: userMsg.time.created,
      finalAssistantStartedAtMs: assistantMsg?.time.created ?? null,
      error: assistantMsg?.error ?? null,
      diff: null,
      items
    });
  }

  return turns;
}

export function partToTurnItem(part: Part): MappedTurnItem | null {
  switch (part.type) {
    case "text": {
      const textPart = part as TextPart;
      if (textPart.synthetic || textPart.ignored) {
        return null;
      }
      return {
        id: textPart.id,
        type: "agentMessage",
        text: textPart.text
      };
    }

    case "reasoning": {
      const reasoningPart = part as ReasoningPart;
      return {
        id: reasoningPart.id,
        type: "reasoning",
        text: reasoningPart.text
      };
    }

    case "tool": {
      const toolPart = part as ToolPart;
      return toolPartToTurnItem(toolPart);
    }

    case "file": {
      const filePart = part as FilePart;
      return {
        id: filePart.id,
        type: "fileChange",
        changes: [{
          path: filePart.url,
          kind: { type: "created" }
        }],
        status: "completed"
      };
    }

    case "step-start":
    case "step-finish":
    case "snapshot":
    case "patch":
    case "agent":
    case "retry":
    case "compaction":
    case "subtask":
      return null;

    default:
      return null;
  }
}

function toolPartToTurnItem(toolPart: ToolPart): MappedTurnItem {
  const state = toolPart.state;
  const toolName = toolPart.tool;
  const status = resolveToolStatus(state);

  if (isFileEditTool(toolName)) {
    return {
      id: toolPart.id,
      type: "fileChange",
      changes: extractFileChanges(toolName, state),
      status
    };
  }

  const input = state.input;
  const command = typeof input["command"] === "string"
    ? input["command"]
    : toolName;

  return {
    id: toolPart.id,
    type: "commandExecution",
    command,
    status,
    ...(typeof input["cwd"] === "string" ? { cwd: input["cwd"] } : {}),
    aggregatedOutput: extractToolOutput(state),
    exitCode: extractExitCode(state),
    durationMs: extractDurationMs(state)
  };
}

function isFileEditTool(toolName: string): boolean {
  return toolName === "write" || toolName === "edit" || toolName === "multiedit";
}

function extractFileChanges(
  toolName: string,
  state: ToolState
): Array<{ path: string; kind: { type: string }; diff?: string }> {
  const input = state.input;
  const filePath = typeof input["file_path"] === "string"
    ? input["file_path"]
    : typeof input["path"] === "string"
      ? input["path"]
      : "(unknown)";

  const output = extractToolOutput(state);
  return [{
    path: filePath,
    kind: { type: toolName === "write" ? "created" : "modified" },
    ...(output !== null ? { diff: output } : {})
  }];
}

function resolveToolStatus(state: ToolState): string {
  return state.status === "error" ? "error" : state.status;
}

function extractToolOutput(state: ToolState): string | null {
  if (state.status === "completed") {
    return state.output;
  }
  if (state.status === "error") {
    return state.error;
  }
  return null;
}

function extractExitCode(state: ToolState): number | null {
  if (state.status === "completed" || state.status === "error") {
    const metadata = state.metadata;
    if (metadata && typeof metadata["exit_code"] === "number") {
      return metadata["exit_code"];
    }
  }
  return null;
}

function extractDurationMs(state: ToolState): number | null {
  if (state.status === "completed") {
    return state.time.end - state.time.start;
  }
  if (state.status === "error") {
    return state.time.end - state.time.start;
  }
  return null;
}

export type OpenCodeEvent =
  | EventMessageUpdated
  | EventMessagePartUpdated
  | EventSessionUpdated
  | EventSessionStatus
  | EventPermissionUpdated;

/**
 * Maps OpenCode SSE events to a Farfield-compatible SSE payload.
 * Returns null for events that should be filtered out.
 */
export function mapOpenCodeEventToSsePayload(
  event: OpenCodeEvent,
  sessionId: string
): unknown | null {
  switch (event.type) {
    case "message.updated": {
      const msg = event.properties.info;
      if (msg.sessionID !== sessionId) {
        return null;
      }
      return {
        type: "opencode-message-updated",
        sessionId,
        message: msg
      };
    }

    case "message.part.updated": {
      const part = event.properties.part;
      if (part.sessionID !== sessionId) {
        return null;
      }
      return {
        type: "opencode-part-updated",
        sessionId,
        part,
        delta: event.properties.delta ?? null
      };
    }

    case "session.updated": {
      const info = event.properties.info;
      if (info.id !== sessionId) {
        return null;
      }
      return {
        type: "opencode-session-updated",
        sessionId,
        session: info
      };
    }

    case "session.status": {
      if (event.properties.sessionID !== sessionId) {
        return null;
      }
      return {
        type: "opencode-session-status",
        sessionId,
        status: event.properties.status
      };
    }

    case "permission.updated": {
      if (event.properties.sessionID !== sessionId) {
        return null;
      }
      return {
        type: "opencode-permission-request",
        sessionId,
        permission: event.properties
      };
    }

    default:
      return null;
  }
}

import type {
  AssistantMessage,
  Event,
  Message,
  Part,
  Session,
  ToolPart,
  ToolState
} from "@opencode-ai/sdk";
import { z } from "zod";
import {
  OPENCODE_EVENT_TYPES,
  OPENCODE_PART_TYPES,
  type OpenCodeEventType,
  type OpenCodePartType
} from "./generated/OpenCodeManifest.js";

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
    }
  | {
      id: string;
      type: "error";
      message: string;
    }
  | {
      id: string;
      type: "contextCompaction";
      completed?: boolean;
    }
  | {
      id: string;
      type: "plan";
      text: string;
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
  error: null;
  diff: null;
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

export interface OpenCodeSsePayload {
  type: "opencode-event";
  sessionId: string;
  relatedSessionId: string | null;
  relevantToSession: boolean;
  eventType: OpenCodeEventType;
  payload: Event;
}

const ToolInputSchema = z
  .object({
    command: z.string().optional(),
    cwd: z.string().optional(),
    file_path: z.string().optional(),
    path: z.string().optional()
  })
  .passthrough();

const ToolMetadataSchema = z
  .object({
    exit_code: z.number().int().optional()
  })
  .passthrough();

type PartByType<K extends OpenCodePartType> = Extract<Part, { type: K }>;
type EventByType<K extends OpenCodeEventType> = Extract<Event, { type: K }>;

type PartMapperTable = {
  [K in OpenCodePartType]: (part: PartByType<K>) => MappedTurnItem;
};

type EventSessionIdExtractorTable = {
  [K in OpenCodeEventType]: (event: EventByType<K>) => string | null;
};

const OPEN_CODE_PART_MAPPERS: PartMapperTable = {
  agent: (part) => ({
    id: part.id,
    type: "agentMessage",
    text: `[agent] ${part.name}`
  }),
  compaction: (part) => ({
    id: part.id,
    type: "contextCompaction",
    completed: true
  }),
  file: (part) => ({
    id: part.id,
    type: "fileChange",
    changes: [{
      path: part.url,
      kind: { type: "created" },
      ...(part.source ? { diff: part.source.text.value } : {})
    }],
    status: "completed"
  }),
  patch: (part) => ({
    id: part.id,
    type: "fileChange",
    changes: part.files.map((filePath) => ({
      path: filePath,
      kind: { type: "modified" }
    })),
    status: "completed"
  }),
  reasoning: (part) => ({
    id: part.id,
    type: "reasoning",
    text: part.text
  }),
  retry: (part) => ({
    id: part.id,
    type: "error",
    message: part.error.data.message
  }),
  snapshot: (part) => ({
    id: part.id,
    type: "contextCompaction",
    completed: false
  }),
  "step-finish": (part) => ({
    id: part.id,
    type: "reasoning",
    text: `Step finished (${part.reason})`
  }),
  "step-start": (part) => ({
    id: part.id,
    type: "reasoning",
    text: "Step started"
  }),
  subtask: (part) => ({
    id: part.id,
    type: "plan",
    text: `${part.description}\n\n${part.prompt}`
  }),
  text: (part) => ({
    id: part.id,
    type: "agentMessage",
    text: `${part.synthetic ? "[synthetic] " : ""}${part.ignored ? "[ignored] " : ""}${part.text}`
  }),
  tool: (part) => toolPartToTurnItem(part)
};

const OPEN_CODE_EVENT_SESSION_ID_EXTRACTORS: EventSessionIdExtractorTable = {
  "command.executed": (event) => event.properties.sessionID,
  "file.edited": () => null,
  "file.watcher.updated": () => null,
  "installation.update-available": () => null,
  "installation.updated": () => null,
  "lsp.client.diagnostics": () => null,
  "lsp.updated": () => null,
  "message.part.removed": (event) => event.properties.sessionID,
  "message.part.updated": (event) => event.properties.part.sessionID,
  "message.removed": (event) => event.properties.sessionID,
  "message.updated": (event) => event.properties.info.sessionID,
  "permission.replied": (event) => event.properties.sessionID,
  "permission.updated": (event) => event.properties.sessionID,
  "pty.created": () => null,
  "pty.deleted": () => null,
  "pty.exited": () => null,
  "pty.updated": () => null,
  "server.connected": () => null,
  "server.instance.disposed": () => null,
  "session.compacted": (event) => event.properties.sessionID,
  "session.created": (event) => event.properties.info.id,
  "session.deleted": (event) => event.properties.info.id,
  "session.diff": (event) => event.properties.sessionID,
  "session.error": (event) => event.properties.sessionID ?? null,
  "session.idle": (event) => event.properties.sessionID,
  "session.status": (event) => event.properties.sessionID,
  "session.updated": (event) => event.properties.info.id,
  "todo.updated": (event) => event.properties.sessionID,
  "tui.command.execute": () => null,
  "tui.prompt.append": () => null,
  "tui.toast.show": () => null,
  "vcs.branch.updated": () => null
};

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
    (message): message is AssistantMessage => message.role === "assistant"
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

  for (const message of messages) {
    if (message.role === "assistant") {
      assistantByParent.set(message.parentID, message);
    }
  }

  for (const message of messages) {
    if (message.role !== "user") {
      continue;
    }

    const assistantMessage = assistantByParent.get(message.id) ?? null;
    const items: MappedTurnItem[] = [];

    const userParts = partsByMessage.get(message.id) ?? [];
    if (userParts.length > 0) {
      items.push({
        id: `${message.id}-input`,
        type: "userMessage",
        content: userParts.map(partToUserMessageContent)
      });
    }

    if (assistantMessage) {
      const assistantParts = partsByMessage.get(assistantMessage.id) ?? [];
      for (const part of assistantParts) {
        items.push(partToTurnItem(part));
      }
    }

    const isCompleted = assistantMessage?.finish === "stop" || assistantMessage?.finish === "length";
    const hasError = assistantMessage?.error != null;

    turns.push({
      turnId: assistantMessage?.id ?? null,
      id: message.id,
      status: hasError ? "error" : isCompleted ? "completed" : assistantMessage ? "running" : "pending",
      turnStartedAtMs: message.time.created,
      finalAssistantStartedAtMs: assistantMessage?.time.created ?? null,
      error: null,
      diff: null,
      items
    });
  }

  return turns;
}

export function partToTurnItem(part: Part): MappedTurnItem {
  return mapPart(part);
}

export function mapOpenCodeEventToSsePayload(
  event: Event,
  sessionId: string
): OpenCodeSsePayload {
  const relatedSessionId = extractRelatedSessionId(event);

  return {
    type: "opencode-event",
    sessionId,
    relatedSessionId,
    relevantToSession: relatedSessionId === null ? true : relatedSessionId === sessionId,
    eventType: event.type,
    payload: event
  };
}

function mapPart<K extends OpenCodePartType>(part: PartByType<K>): MappedTurnItem {
  return OPEN_CODE_PART_MAPPERS[part.type](part);
}

function extractRelatedSessionId<K extends OpenCodeEventType>(event: EventByType<K>): string | null {
  return OPEN_CODE_EVENT_SESSION_ID_EXTRACTORS[event.type](event);
}

function partToUserMessageContent(part: Part): { type: "text"; text: string } {
  switch (part.type) {
    case "text":
      return { type: "text", text: part.text };
    case "tool":
      return { type: "text", text: `[tool] ${part.tool}` };
    case "file":
      return { type: "text", text: `[file] ${part.url}` };
    case "reasoning":
      return { type: "text", text: `[reasoning] ${part.text}` };
    case "step-start":
      return { type: "text", text: "[step-start]" };
    case "step-finish":
      return { type: "text", text: `[step-finish] ${part.reason}` };
    case "snapshot":
      return { type: "text", text: "[snapshot]" };
    case "patch":
      return { type: "text", text: `[patch] ${part.files.join(", ")}` };
    case "agent":
      return { type: "text", text: `[agent] ${part.name}` };
    case "retry":
      return { type: "text", text: `[retry] ${part.error.data.message}` };
    case "compaction":
      return { type: "text", text: "[compaction]" };
    case "subtask":
      return { type: "text", text: `[subtask] ${part.description}` };
  }
}

function toolPartToTurnItem(toolPart: ToolPart): MappedTurnItem {
  const state = toolPart.state;
  const status = resolveToolStatus(state);

  if (isFileEditTool(toolPart.tool)) {
    return {
      id: toolPart.id,
      type: "fileChange",
      changes: extractFileChanges(toolPart.tool, state),
      status
    };
  }

  const parsedInput = ToolInputSchema.parse(state.input);
  return {
    id: toolPart.id,
    type: "commandExecution",
    command: parsedInput.command ?? toolPart.tool,
    status,
    ...(parsedInput.cwd ? { cwd: parsedInput.cwd } : {}),
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
  const parsedInput = ToolInputSchema.parse(state.input);
  const filePath = parsedInput.file_path ?? parsedInput.path ?? "(unavailable path)";
  const output = extractToolOutput(state);

  return [{
    path: filePath,
    kind: { type: toolName === "write" ? "created" : "modified" },
    ...(output !== null ? { diff: output } : {})
  }];
}

function resolveToolStatus(state: ToolState): string {
  return state.status;
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
    const metadata = ToolMetadataSchema.parse(state.metadata ?? {});
    return metadata.exit_code ?? null;
  }

  return null;
}

function extractDurationMs(state: ToolState): number | null {
  if (state.status === "completed" || state.status === "error") {
    return state.time.end - state.time.start;
  }

  return null;
}

type AssertTrue<T extends true> = T;
type IsNever<T> = [T] extends [never] ? true : false;

type SdkEventType = Event["type"];
type SdkPartType = Part["type"];
type ManifestEventType = typeof OPENCODE_EVENT_TYPES[number];
type ManifestPartType = typeof OPENCODE_PART_TYPES[number];

type MissingPartMapper = Exclude<SdkPartType, keyof typeof OPEN_CODE_PART_MAPPERS>;
type ExtraPartMapper = Exclude<keyof typeof OPEN_CODE_PART_MAPPERS, SdkPartType>;
type MissingEventExtractor = Exclude<SdkEventType, keyof typeof OPEN_CODE_EVENT_SESSION_ID_EXTRACTORS>;
type ExtraEventExtractor = Exclude<keyof typeof OPEN_CODE_EVENT_SESSION_ID_EXTRACTORS, SdkEventType>;
type MissingManifestEvent = Exclude<SdkEventType, ManifestEventType>;
type ExtraManifestEvent = Exclude<ManifestEventType, SdkEventType>;
type MissingManifestPart = Exclude<SdkPartType, ManifestPartType>;
type ExtraManifestPart = Exclude<ManifestPartType, SdkPartType>;

type _AssertNoMissingPartMapper = AssertTrue<IsNever<MissingPartMapper>>;
type _AssertNoExtraPartMapper = AssertTrue<IsNever<ExtraPartMapper>>;
type _AssertNoMissingEventExtractor = AssertTrue<IsNever<MissingEventExtractor>>;
type _AssertNoExtraEventExtractor = AssertTrue<IsNever<ExtraEventExtractor>>;
type _AssertManifestEventMatchesSdk = AssertTrue<IsNever<MissingManifestEvent | ExtraManifestEvent>>;
type _AssertManifestPartMatchesSdk = AssertTrue<IsNever<MissingManifestPart | ExtraManifestPart>>;

void ({
  partTypes: OPENCODE_PART_TYPES,
  eventTypes: OPENCODE_EVENT_TYPES,
  partMappers: OPEN_CODE_PART_MAPPERS,
  eventExtractors: OPEN_CODE_EVENT_SESSION_ID_EXTRACTORS
});

import {
  AppServerCollaborationModeListResponseSchema,
  AppServerListThreadsResponseSchema,
  AppServerReadThreadResponseSchema,
  type CollaborationMode,
  ThreadConversationStateSchema,
  UserInputRequestSchema,
  UserInputResponsePayloadSchema
} from "@codex-monitor/codex-protocol";
import { z } from "zod";

const ApiEnvelopeSchema = z
  .object({
    ok: z.boolean(),
    error: z.string().optional()
  })
  .passthrough();

const HealthResponseSchema = z
  .object({
    ok: z.literal(true),
    state: z
      .object({
        appReady: z.boolean(),
        ipcConnected: z.boolean(),
        ipcInitialized: z.boolean(),
        lastError: z.string().nullable(),
        historyCount: z.number().int().nonnegative(),
        threadOwnerCount: z.number().int().nonnegative()
      })
      .passthrough()
  })
  .strict();

const LiveStateResponseSchema = z
  .object({
    ok: z.literal(true),
    threadId: z.string(),
    ownerClientId: z.string().nullable(),
    conversationState: z.union([ThreadConversationStateSchema, z.null()])
  })
  .strict();

const StreamEventsResponseSchema = z
  .object({
    ok: z.literal(true),
    threadId: z.string(),
    ownerClientId: z.string().nullable(),
    events: z.array(z.unknown())
  })
  .strict();

const TraceStatusSchema = z
  .object({
    ok: z.literal(true),
    active: z
      .object({
        id: z.string(),
        label: z.string(),
        startedAt: z.string(),
        stoppedAt: z.string().nullable(),
        eventCount: z.number().int().nonnegative(),
        path: z.string()
      })
      .nullable(),
    recent: z.array(
      z.object({
        id: z.string(),
        label: z.string(),
        startedAt: z.string(),
        stoppedAt: z.string().nullable(),
        eventCount: z.number().int().nonnegative(),
        path: z.string()
      })
    )
  })
  .strict();

const HistoryListSchema = z
  .object({
    ok: z.literal(true),
    history: z.array(
      z.object({
        id: z.string(),
        at: z.string(),
        source: z.enum(["ipc", "app", "system"]),
        direction: z.enum(["in", "out", "system"]),
        payload: z.unknown(),
        meta: z.record(z.unknown())
      })
    )
  })
  .strict();

const HistoryDetailSchema = z
  .object({
    ok: z.literal(true),
    entry: HistoryListSchema.shape.history.element,
    fullPayload: z.unknown()
  })
  .strict();

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(path, init);
  const data = (await response.json()) as unknown;
  const envelope = ApiEnvelopeSchema.parse(data);

  if (!response.ok || !envelope.ok) {
    throw new Error(typeof envelope.error === "string" ? envelope.error : "Request failed");
  }

  return data;
}

function stripOk(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return value;
  }

  const { ok: _ok, ...rest } = value as Record<string, unknown>;
  return rest;
}

export async function getHealth(): Promise<z.infer<typeof HealthResponseSchema>> {
  return HealthResponseSchema.parse(await request("/api/health"));
}

export async function listThreads(options: {
  limit: number;
  archived: boolean;
  all: boolean;
  maxPages: number;
}): Promise<z.infer<typeof AppServerListThreadsResponseSchema>> {
  const params = new URLSearchParams();
  params.set("limit", String(options.limit));
  params.set("archived", options.archived ? "1" : "0");
  params.set("all", options.all ? "1" : "0");
  params.set("maxPages", String(options.maxPages));

  const data = await request(`/api/threads?${params.toString()}`);
  return AppServerListThreadsResponseSchema.parse(stripOk(data));
}

export async function readThread(threadId: string): Promise<z.infer<typeof AppServerReadThreadResponseSchema>> {
  const data = await request(`/api/threads/${encodeURIComponent(threadId)}?includeTurns=true`);
  return AppServerReadThreadResponseSchema.parse(stripOk(data));
}

export async function listCollaborationModes(): Promise<
  z.infer<typeof AppServerCollaborationModeListResponseSchema>
> {
  const data = await request("/api/collaboration-modes");
  return AppServerCollaborationModeListResponseSchema.parse(stripOk(data));
}

export async function getLiveState(threadId: string): Promise<z.infer<typeof LiveStateResponseSchema>> {
  const data = await request(`/api/threads/${encodeURIComponent(threadId)}/live-state`);
  return LiveStateResponseSchema.parse(data);
}

export async function getStreamEvents(threadId: string): Promise<z.infer<typeof StreamEventsResponseSchema>> {
  const data = await request(`/api/threads/${encodeURIComponent(threadId)}/stream-events?limit=80`);
  return StreamEventsResponseSchema.parse(data);
}

export async function sendMessage(input: {
  threadId: string;
  ownerClientId?: string;
  text: string;
  cwd?: string;
}): Promise<void> {
  await request(`/api/threads/${encodeURIComponent(input.threadId)}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });
}

export async function setCollaborationMode(input: {
  threadId: string;
  ownerClientId?: string;
  collaborationMode: CollaborationMode;
}): Promise<void> {
  await request(`/api/threads/${encodeURIComponent(input.threadId)}/collaboration-mode`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });
}

export async function submitUserInput(input: {
  threadId: string;
  ownerClientId?: string;
  requestId: number;
  response: z.infer<typeof UserInputResponsePayloadSchema>;
}): Promise<void> {
  UserInputResponsePayloadSchema.parse(input.response);

  await request(`/api/threads/${encodeURIComponent(input.threadId)}/user-input`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });
}

export async function interruptThread(input: {
  threadId: string;
  ownerClientId?: string;
}): Promise<void> {
  await request(`/api/threads/${encodeURIComponent(input.threadId)}/interrupt`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });
}

export async function getTraceStatus(): Promise<z.infer<typeof TraceStatusSchema>> {
  const data = await request("/api/debug/trace/status");
  return TraceStatusSchema.parse(data);
}

export async function startTrace(label: string): Promise<void> {
  await request("/api/debug/trace/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label })
  });
}

export async function markTrace(note: string): Promise<void> {
  await request("/api/debug/trace/mark", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ note })
  });
}

export async function stopTrace(): Promise<void> {
  await request("/api/debug/trace/stop", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });
}

export async function listDebugHistory(limit = 120): Promise<z.infer<typeof HistoryListSchema>> {
  const data = await request(`/api/debug/history?limit=${String(limit)}`);
  return HistoryListSchema.parse(data);
}

export async function getHistoryEntry(entryId: string): Promise<z.infer<typeof HistoryDetailSchema>> {
  const data = await request(`/api/debug/history/${encodeURIComponent(entryId)}`);
  return HistoryDetailSchema.parse(data);
}

export async function replayHistoryEntry(input: {
  entryId: string;
  waitForResponse: boolean;
}): Promise<unknown> {
  return request("/api/debug/replay", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export function getPendingUserInputRequests(
  conversationState: z.infer<typeof ThreadConversationStateSchema> | null
): z.infer<typeof UserInputRequestSchema>[] {
  if (!conversationState) {
    return [];
  }

  return conversationState.requests.filter((request) => {
    if (request.method !== "item/tool/requestUserInput") {
      return false;
    }
    return request.completed !== true;
  });
}

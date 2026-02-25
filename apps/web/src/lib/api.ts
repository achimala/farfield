import {
  AppServerCollaborationModeListResponseSchema,
  AppServerListModelsResponseSchema,
  AppServerListThreadsResponseSchema,
  AppServerReadThreadResponseSchema,
  AppServerStartThreadResponseSchema,
  type CollaborationMode,
  AppServerGetAccountRateLimitsResponseSchema,
  ThreadConversationStateSchema,
  UserInputRequestSchema,
  UserInputResponsePayloadSchema
} from "@farfield/protocol";
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
        gitCommit: z.string().nullable().optional(),
        lastError: z.string().nullable(),
        historyCount: z.number().int().nonnegative(),
        threadOwnerCount: z.number().int().nonnegative()
      })
      .passthrough()
  })
  .passthrough();

const LiveStateResponseSchema: z.ZodObject<
  {
    ok: z.ZodLiteral<true>;
    threadId: z.ZodString;
    ownerClientId: z.ZodNullable<z.ZodString>;
    conversationState: z.ZodUnion<[typeof ThreadConversationStateSchema, z.ZodNull]>;
    liveStateError: z.ZodNullable<
      z.ZodObject<{
        kind: z.ZodLiteral<"reductionFailed">;
        message: z.ZodString;
        eventIndex: z.ZodNullable<z.ZodNumber>;
        patchIndex: z.ZodNullable<z.ZodNumber>;
      }>
    >;
  },
  "passthrough"
> = z
  .object({
    ok: z.literal(true),
    threadId: z.string(),
    ownerClientId: z.string().nullable(),
    conversationState: z.union([ThreadConversationStateSchema, z.null()]),
    liveStateError: z
      .object({
        kind: z.literal("reductionFailed"),
        message: z.string(),
        eventIndex: z.number().int().nonnegative().nullable(),
        patchIndex: z.number().int().nonnegative().nullable()
      })
      .nullable()
  })
  .passthrough();

const StreamEventsResponseSchema = z
  .object({
    ok: z.literal(true),
    threadId: z.string(),
    ownerClientId: z.string().nullable(),
    events: z.array(z.unknown())
  })
  .passthrough();

const CreateThreadResponseSchema = z
  .object({
    ok: z.literal(true),
    threadId: z.string(),
    agentId: z.enum(["codex", "opencode"])
  })
  .merge(AppServerStartThreadResponseSchema)
  .passthrough();

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
  .passthrough();

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
  .passthrough();

const HistoryDetailSchema = z
  .object({
    ok: z.literal(true),
    entry: HistoryListSchema.shape.history.element,
    fullPayload: z.unknown()
  })
  .passthrough();

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

const AgentIdSchema = z.enum(["codex", "opencode"]);
export type AgentId = z.infer<typeof AgentIdSchema>;

const AgentCapabilitiesSchema = z
  .object({
    canListModels: z.boolean(),
    canListCollaborationModes: z.boolean(),
    canSetCollaborationMode: z.boolean(),
    canSubmitUserInput: z.boolean(),
    canReadLiveState: z.boolean(),
    canReadStreamEvents: z.boolean(),
    canReadRateLimits: z.boolean()
  })
  .strict();

const AgentsResponseSchema = z
  .object({
    ok: z.literal(true),
    agents: z.array(
      z.object({
        id: AgentIdSchema,
        label: z.string(),
        enabled: z.boolean(),
        connected: z.boolean(),
        capabilities: AgentCapabilitiesSchema,
        projectDirectories: z.array(z.string())
      })
    ),
    defaultAgentId: AgentIdSchema
  })
  .strict();

export async function listAgents(): Promise<z.infer<typeof AgentsResponseSchema>> {
  return AgentsResponseSchema.parse(await request("/api/agents"));
}

const ThreadListItemWithAgentSchema = AppServerListThreadsResponseSchema.shape.data.element.and(
  z
    .object({
      agentId: z.enum(["codex", "opencode"]),
      source: z.string().optional()
    })
    .passthrough()
);

const ThreadListResponseSchema = z
  .object({
    data: z.array(ThreadListItemWithAgentSchema),
    nextCursor: z.union([z.string(), z.null(), z.undefined()]).transform((v) => v ?? null),
    pages: z.number().int().nonnegative().optional(),
    truncated: z.boolean().optional()
  });

export async function listThreads(options: {
  limit: number;
  archived: boolean;
  all: boolean;
  maxPages: number;
}): Promise<z.infer<typeof ThreadListResponseSchema>> {
  const params = new URLSearchParams();
  params.set("limit", String(options.limit));
  params.set("archived", options.archived ? "true" : "false");
  params.set("all", options.all ? "true" : "false");
  params.set("maxPages", String(options.maxPages));

  const data = await request(`/api/threads?${params.toString()}`);
  return ThreadListResponseSchema.parse(stripOk(data));
}

const ReadThreadResponseWithAgentSchema = AppServerReadThreadResponseSchema.extend({
  agentId: z.enum(["codex", "opencode"])
});

export async function readThread(
  threadId: string,
  options?: { includeTurns?: boolean }
): Promise<z.infer<typeof ReadThreadResponseWithAgentSchema>> {
  const includeTurns = options?.includeTurns ?? true;
  const data = await request(
    `/api/threads/${encodeURIComponent(threadId)}?includeTurns=${includeTurns ? "true" : "false"}`
  );
  return ReadThreadResponseWithAgentSchema.parse(stripOk(data));
}

export async function createThread(input?: {
  agentId?: AgentId;
  cwd?: string;
  model?: string;
  modelProvider?: string;
  personality?: string;
  sandbox?: string;
  approvalPolicy?: string;
  ephemeral?: boolean;
}): Promise<z.infer<typeof CreateThreadResponseSchema>> {
  const data = await request("/api/threads", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input ?? {})
  });
  return CreateThreadResponseSchema.parse(data);
}

export async function listCollaborationModes(): Promise<
  z.infer<typeof AppServerCollaborationModeListResponseSchema>
> {
  return listCollaborationModesForAgent();
}

export async function listCollaborationModesForAgent(options?: {
  agentId?: AgentId;
}): Promise<z.infer<typeof AppServerCollaborationModeListResponseSchema>> {
  const params = new URLSearchParams();
  if (options?.agentId) {
    params.set("agentId", options.agentId);
  }
  const query = params.toString();
  const data = await request(`/api/collaboration-modes${query ? `?${query}` : ""}`);
  return AppServerCollaborationModeListResponseSchema.parse(stripOk(data));
}

export async function listModels(): Promise<z.infer<typeof AppServerListModelsResponseSchema>> {
  return listModelsForAgent();
}

export async function listModelsForAgent(options?: {
  agentId?: AgentId;
}): Promise<z.infer<typeof AppServerListModelsResponseSchema>> {
  const params = new URLSearchParams();
  params.set("limit", "200");
  if (options?.agentId) {
    params.set("agentId", options.agentId);
  }
  const data = await request(`/api/models?${params.toString()}`);
  return AppServerListModelsResponseSchema.parse(stripOk(data));
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
  const { threadId, ...body } = input;

  await request(`/api/threads/${encodeURIComponent(threadId)}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

export async function setCollaborationMode(input: {
  threadId: string;
  ownerClientId?: string;
  collaborationMode: CollaborationMode;
}): Promise<void> {
  const { threadId, ...body } = input;

  await request(`/api/threads/${encodeURIComponent(threadId)}/collaboration-mode`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

export async function submitUserInput(input: {
  threadId: string;
  ownerClientId?: string;
  requestId: number;
  response: z.infer<typeof UserInputResponsePayloadSchema>;
}): Promise<void> {
  UserInputResponsePayloadSchema.parse(input.response);

  const { threadId, ...body } = input;

  await request(`/api/threads/${encodeURIComponent(threadId)}/user-input`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

export async function interruptThread(input: {
  threadId: string;
  ownerClientId?: string;
}): Promise<void> {
  const { threadId, ...body } = input;

  await request(`/api/threads/${encodeURIComponent(threadId)}/interrupt`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
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

const AccountRateLimitsResponseSchema = z
  .object({
    ok: z.literal(true)
  })
  .merge(AppServerGetAccountRateLimitsResponseSchema)
  .passthrough();

export async function getAccountRateLimits(): Promise<z.infer<typeof AppServerGetAccountRateLimitsResponseSchema>> {
  const data = await request("/api/account/rate-limits");
  const parsed = AccountRateLimitsResponseSchema.parse(data);
  return AppServerGetAccountRateLimitsResponseSchema.parse({
    rateLimits: parsed.rateLimits,
    rateLimitsByLimitId: parsed.rateLimitsByLimitId
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

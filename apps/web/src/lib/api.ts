import {
  UnifiedApprovalThreadRequestSchema,
  JsonValueSchema,
  UnifiedCollaborationModeSchema,
  UnifiedCommandResponseSchema,
  UnifiedCommandSchema,
  UnifiedFeatureAvailabilitySchema,
  UnifiedFeatureIdSchema,
  UnifiedFeatureMatrixSchema,
  UnifiedModelSchema,
  UnifiedProviderIdSchema,
  UnifiedThreadSchema,
  UnifiedThreadSummarySchema,
  UnifiedThreadRequestResponseSchema,
  UnifiedUserInputRequestIdSchema,
  type JsonValue,
  type UnifiedApprovalThreadRequest,
  type UnifiedCommand,
  type UnifiedCommandResult,
  type UnifiedFeatureAvailability,
  type UnifiedFeatureId,
  type UnifiedProviderId,
  type UnifiedThread,
  type UnifiedThreadRequestResponse,
  type UnifiedUserInputRequest,
} from "@farfield/unified-surface";
import { AppServerGetAccountRateLimitsResponseSchema } from "@farfield/protocol";
import { z } from "zod";
import {
  buildServerUrl,
  clearStoredServerTarget,
  getDefaultServerBaseUrl as getDefaultStoredServerBaseUrl,
  parseServerBaseUrl,
  readStoredServerTarget,
  resolveServerBaseUrl,
  saveServerBaseUrl,
} from "./server-target";

const ApiEnvelopeSchema = z
  .object({
    ok: z.boolean(),
  })
  .passthrough();

const ApiFailureEnvelopeSchema = z
  .object({
    ok: z.literal(false),
    error: z.union([
      z.string(),
      z
        .object({
          code: z.string().optional(),
          message: z.string().optional(),
          details: JsonValueSchema.optional(),
        })
        .passthrough(),
    ]),
  })
  .passthrough();

const UnifiedProviderErrorSchema = z
  .object({
    code: z.string(),
    message: z.string(),
    details: JsonValueSchema.optional(),
  })
  .strict();

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
        threadOwnerCount: z.number().int().nonnegative(),
      })
      .passthrough(),
  })
  .passthrough();

const UnifiedThreadsEnvelopeSchema = z
  .object({
    ok: z.literal(true),
    data: z.array(UnifiedThreadSummarySchema),
    cursors: z
      .object({
        codex: z.string().nullable(),
        opencode: z.string().nullable(),
      })
      .strict(),
    errors: z
      .object({
        codex: z.union([UnifiedProviderErrorSchema, z.null()]),
        opencode: z.union([UnifiedProviderErrorSchema, z.null()]),
      })
      .strict(),
  })
  .strict();

const UnifiedReadThreadEnvelopeSchema = z
  .object({
    ok: z.literal(true),
    thread: UnifiedThreadSchema,
  })
  .strict();

const UnifiedFeaturesEnvelopeSchema = z
  .object({
    ok: z.literal(true),
    features: UnifiedFeatureMatrixSchema,
  })
  .strict();

const LiveStateResponseSchema = z
  .object({
    ok: z.literal(true),
    threadId: z.string(),
    ownerClientId: z.string().nullable(),
    conversationState: z.union([UnifiedThreadSchema, z.null()]),
    liveStateError: z
      .union([
        z
          .object({
            kind: z.literal("reductionFailed"),
            message: z.string(),
            eventIndex: z.union([z.number().int().nonnegative(), z.null()]),
            patchIndex: z.union([z.number().int().nonnegative(), z.null()]),
          })
          .strict(),
        z
          .object({
            kind: z.literal("parseFailed"),
            message: z.string(),
            eventIndex: z.union([z.number().int().nonnegative(), z.null()]),
            patchIndex: z.union([z.number().int().nonnegative(), z.null()]),
          })
          .strict(),
        z.null(),
      ])
      .nullable(),
  })
  .strict();

const StreamEventsResponseSchema = z
  .object({
    ok: z.literal(true),
    threadId: z.string(),
    ownerClientId: z.string().nullable(),
    events: z.array(JsonValueSchema),
  })
  .strict();

const CreateThreadResponseSchema = z
  .object({
    threadId: z.string(),
    thread: UnifiedThreadSchema,
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
        path: z.string(),
      })
      .nullable(),
    recent: z.array(
      z.object({
        id: z.string(),
        label: z.string(),
        startedAt: z.string(),
        stoppedAt: z.string().nullable(),
        eventCount: z.number().int().nonnegative(),
        path: z.string(),
      }),
    ),
  })
  .passthrough();

const HistoryEntrySummarySchema = z
  .object({
    id: z.string(),
    at: z.string(),
    source: z.enum(["ipc", "app", "system"]),
    direction: z.enum(["in", "out", "system"]),
    meta: z.record(JsonValueSchema),
  })
  .strict();

const HistoryListSchema = z
  .object({
    ok: z.literal(true),
    history: z.array(HistoryEntrySummarySchema),
  })
  .passthrough();

const HistoryDetailSchema = z
  .object({
    ok: z.literal(true),
    entry: HistoryEntrySummarySchema,
    fullPayloadJson: z.string(),
  })
  .passthrough();

const AgentCapabilitiesSchema = z
  .object({
    canListModels: z.boolean(),
    canListCollaborationModes: z.boolean(),
    canSetCollaborationMode: z.boolean(),
    canSubmitUserInput: z.boolean(),
    canReadLiveState: z.boolean(),
    canReadStreamEvents: z.boolean(),
    canListProjectDirectories: z.boolean(),
  })
  .strict();

const AgentDescriptorSchema = z
  .object({
    id: UnifiedProviderIdSchema,
    label: z.string(),
    enabled: z.boolean(),
    connected: z.boolean(),
    features: z.record(
      UnifiedFeatureIdSchema,
      UnifiedFeatureAvailabilitySchema,
    ),
    capabilities: AgentCapabilitiesSchema,
    projectDirectories: z.array(z.string()),
  })
  .strict();

const AgentsResponseSchema = z
  .object({
    ok: z.literal(true),
    agents: z.array(AgentDescriptorSchema),
    defaultAgentId: UnifiedProviderIdSchema,
  })
  .strict();

const ThreadListResponseSchema = z
  .object({
    data: z.array(UnifiedThreadSummarySchema),
    cursors: z
      .object({
        codex: z.string().nullable(),
        opencode: z.string().nullable(),
      })
      .strict(),
    errors: z
      .object({
        codex: z.union([UnifiedProviderErrorSchema, z.null()]),
        opencode: z.union([UnifiedProviderErrorSchema, z.null()]),
      })
      .strict(),
  })
  .strict();

const SidebarThreadsEnvelopeSchema = z
  .object({
    ok: z.literal(true),
    rows: z.array(UnifiedThreadSummarySchema),
    errors: z
      .object({
        codex: z.union([UnifiedProviderErrorSchema, z.null()]),
        opencode: z.union([UnifiedProviderErrorSchema, z.null()]),
      })
      .strict(),
  })
  .strict();

const SidebarThreadsResponseSchema = z
  .object({
    rows: z.array(UnifiedThreadSummarySchema),
    errors: z
      .object({
        codex: z.union([UnifiedProviderErrorSchema, z.null()]),
        opencode: z.union([UnifiedProviderErrorSchema, z.null()]),
      })
      .strict(),
  })
  .strict();

const ReadThreadResponseSchema = z
  .object({
    thread: UnifiedThreadSchema,
  })
  .strict();

const ModelsResponseSchema = z
  .object({
    data: z.array(UnifiedModelSchema),
  })
  .strict();

const CollaborationModesResponseSchema = z
  .object({
    data: z.array(UnifiedCollaborationModeSchema),
  })
  .strict();

const PROVIDER_IDS = [
  "codex",
  "opencode",
] as const satisfies ReadonlyArray<UnifiedProviderId>;

const PROVIDER_LABELS: Record<UnifiedProviderId, string> = {
  codex: "Codex",
  opencode: "OpenCode",
};

export type AgentId = UnifiedProviderId;

class UnifiedCommandApiError extends Error {
  public readonly code: string;
  public readonly details?: JsonValue;

  public constructor(code: string, message: string, details?: JsonValue) {
    super(message);
    this.name = "UnifiedCommandApiError";
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
  }
}

export class ApiRequestError extends Error {
  public readonly code: string | null;
  public readonly details?: JsonValue;

  public constructor(
    message: string,
    options?: { code?: string | null; details?: JsonValue },
  ) {
    super(message);
    this.name = "ApiRequestError";
    this.code = options?.code ?? null;
    if (options?.details !== undefined) {
      this.details = options.details;
    }
  }
}

export function getServerBaseUrl(): string {
  return resolveServerBaseUrl();
}

export function getSavedServerBaseUrl(): string | null {
  const stored = readStoredServerTarget();
  return stored?.baseUrl ?? null;
}

export function getDefaultServerBaseUrl(): string {
  return getDefaultStoredServerBaseUrl();
}

export function setServerBaseUrl(value: string): string {
  return saveServerBaseUrl(value).baseUrl;
}

export function clearServerBaseUrl(): void {
  clearStoredServerTarget();
}

export function normalizeServerBaseUrl(value: string): string {
  return parseServerBaseUrl(value);
}

export function getUnifiedEventsUrl(baseUrlOverride?: string): string {
  return buildServerUrl("/api/unified/events", baseUrlOverride);
}

async function requestJson(
  path: string,
  init?: RequestInit,
): Promise<{ response: Response; payload: JsonValue }> {
  const response = await fetch(buildServerUrl(path), init);
  const payload = JsonValueSchema.parse(await response.json());
  return {
    response,
    payload,
  };
}

function readApiFailure(payload: JsonValue): {
  code: string | null;
  message: string;
  details: JsonValue | undefined;
} {
  const parsed = ApiFailureEnvelopeSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiRequestError(
      `Invalid API error envelope: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join(" | ")}`,
      {
        code: "invalidApiErrorEnvelope",
        details: payload,
      },
    );
  }

  if (typeof parsed.data.error === "string") {
    return {
      code: null,
      message: parsed.data.error,
      details: undefined,
    };
  }

  return {
    code: parsed.data.error.code ?? null,
    message:
      parsed.data.error.message ?? parsed.data.error.code ?? "Request failed",
    details: parsed.data.error.details,
  };
}

function buildApiRequestError(payload: JsonValue): ApiRequestError {
  const failure = readApiFailure(payload);
  return new ApiRequestError(failure.message, {
    code: failure.code,
    ...(failure.details !== undefined ? { details: failure.details } : {}),
  });
}

async function requestEnvelope<T>(
  path: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  const { response, payload } = await requestJson(path, init);

  if (!response.ok) {
    throw buildApiRequestError(payload);
  }

  const envelope = ApiEnvelopeSchema.parse(payload);
  if (!envelope.ok) {
    throw buildApiRequestError(payload);
  }

  return schema.parse(payload);
}

async function runUnifiedCommand(
  command: UnifiedCommand,
): Promise<UnifiedCommandResult> {
  const parsedCommand = UnifiedCommandSchema.parse(command);
  const { response, payload } = await requestJson("/api/unified/command", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(parsedCommand),
  });

  if (!response.ok) {
    throw buildApiRequestError(payload);
  }

  const commandResponse = UnifiedCommandResponseSchema.parse(payload);
  if (!commandResponse.ok) {
    throw new UnifiedCommandApiError(
      commandResponse.error.code,
      commandResponse.error.message,
      commandResponse.error.details,
    );
  }

  if (commandResponse.result.kind !== parsedCommand.kind) {
    throw new Error(
      `Unexpected unified command result: expected ${parsedCommand.kind}, received ${commandResponse.result.kind}`,
    );
  }

  return commandResponse.result;
}

function isFeatureAvailable(
  availability: UnifiedFeatureAvailability | undefined,
): boolean {
  return availability?.status === "available";
}

function isProviderEnabled(
  features: Partial<Record<UnifiedFeatureId, UnifiedFeatureAvailability>>,
): boolean {
  return Object.values(features).some((availability) => {
    if (!availability) {
      return false;
    }
    if (availability.status === "available") {
      return true;
    }
    return availability.reason !== "providerDisabled";
  });
}

function isProviderConnected(
  features: Partial<Record<UnifiedFeatureId, UnifiedFeatureAvailability>>,
): boolean {
  return !Object.values(features).some(
    (availability) =>
      availability !== undefined &&
      availability.status === "unavailable" &&
      (availability.reason === "providerDisconnected" ||
        availability.reason === "providerNotReady"),
  );
}

function buildCapabilities(
  features: Partial<Record<UnifiedFeatureId, UnifiedFeatureAvailability>>,
): z.infer<typeof AgentCapabilitiesSchema> {
  return {
    canListModels: isFeatureAvailable(features["listModels"]),
    canListCollaborationModes: isFeatureAvailable(
      features["listCollaborationModes"],
    ),
    canSetCollaborationMode: isFeatureAvailable(
      features["setCollaborationMode"],
    ),
    canSubmitUserInput: isFeatureAvailable(features["submitUserInput"]),
    canReadLiveState: isFeatureAvailable(features["readLiveState"]),
    canReadStreamEvents: isFeatureAvailable(features["readStreamEvents"]),
    canListProjectDirectories: isFeatureAvailable(
      features["listProjectDirectories"],
    ),
  };
}

export async function getHealth(): Promise<
  z.infer<typeof HealthResponseSchema>
> {
  return requestEnvelope("/api/health", HealthResponseSchema);
}

export async function listAgents(): Promise<
  z.infer<typeof AgentsResponseSchema>
> {
  const featuresEnvelope = await requestEnvelope(
    "/api/unified/features",
    UnifiedFeaturesEnvelopeSchema,
  );

  const agentTasks = PROVIDER_IDS.map(async (providerId) => {
    const features = featuresEnvelope.features[providerId];
    const enabled = isProviderEnabled(features);
    const connected = enabled && isProviderConnected(features);

    let projectDirectories: string[] = [];
    if (isFeatureAvailable(features["listProjectDirectories"])) {
      try {
        const result = await runUnifiedCommand({
          kind: "listProjectDirectories",
          provider: providerId,
        });
        if (result.kind === "listProjectDirectories") {
          projectDirectories = result.directories;
        }
      } catch (error) {
        if (!(error instanceof UnifiedCommandApiError)) {
          throw error;
        }
        projectDirectories = [];
      }
    }

    return {
      id: providerId,
      label: PROVIDER_LABELS[providerId],
      enabled,
      connected,
      features,
      capabilities: buildCapabilities(features),
      projectDirectories,
    };
  });

  const agents = await Promise.all(agentTasks);

  const firstEnabledAgentId = agents.find((agent) => agent.enabled)?.id;
  const defaultAgentId = firstEnabledAgentId ?? "codex";

  return AgentsResponseSchema.parse({
    ok: true,
    agents,
    defaultAgentId,
  });
}

export async function listThreads(options: {
  limit: number;
  archived: boolean;
  all: boolean;
  maxPages: number;
  cursor?: string | null;
}): Promise<z.infer<typeof ThreadListResponseSchema>> {
  const params = new URLSearchParams();
  params.set("limit", String(options.limit));
  params.set("archived", options.archived ? "1" : "0");
  params.set("all", options.all ? "1" : "0");
  params.set("maxPages", String(options.maxPages));
  if (typeof options.cursor === "string" && options.cursor.length > 0) {
    params.set("cursor", options.cursor);
  }

  const payload = await requestEnvelope(
    `/api/unified/threads?${params.toString()}`,
    UnifiedThreadsEnvelopeSchema,
  );
  return ThreadListResponseSchema.parse({
    data: payload.data,
    cursors: payload.cursors,
    errors: payload.errors,
  });
}

export async function listSidebarThreads(options: {
  limit: number;
  archived: boolean;
  all: boolean;
  maxPages: number;
  cursor?: string | null;
}): Promise<z.infer<typeof SidebarThreadsResponseSchema>> {
  const params = new URLSearchParams();
  params.set("limit", String(options.limit));
  params.set("archived", options.archived ? "1" : "0");
  params.set("all", options.all ? "1" : "0");
  params.set("maxPages", String(options.maxPages));
  if (typeof options.cursor === "string" && options.cursor.length > 0) {
    params.set("cursor", options.cursor);
  }

  const payload = await requestEnvelope(
    `/api/unified/sidebar?${params.toString()}`,
    SidebarThreadsEnvelopeSchema,
  );

  return SidebarThreadsResponseSchema.parse({
    rows: payload.rows,
    errors: payload.errors,
  });
}

export async function readThread(
  threadId: string,
  options?: { includeTurns?: boolean; provider?: AgentId },
): Promise<z.infer<typeof ReadThreadResponseSchema>> {
  const params = new URLSearchParams();
  if (typeof options?.provider === "string") {
    params.set("provider", options.provider);
  }
  if (typeof options?.includeTurns === "boolean") {
    params.set("includeTurns", options.includeTurns ? "1" : "0");
  }

  const query = params.toString();
  const payload = await requestEnvelope(
    `/api/unified/thread/${encodeURIComponent(threadId)}${query.length > 0 ? `?${query}` : ""}`,
    UnifiedReadThreadEnvelopeSchema,
  );

  return ReadThreadResponseSchema.parse({
    thread: payload.thread,
  });
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
  const provider = input?.agentId ?? "codex";
  const result = await runUnifiedCommand({
    kind: "createThread",
    provider,
    ...(input?.cwd ? { cwd: input.cwd } : {}),
    ...(input?.model ? { model: input.model } : {}),
    ...(input?.modelProvider ? { modelProvider: input.modelProvider } : {}),
    ...(input?.personality ? { personality: input.personality } : {}),
    ...(input?.sandbox ? { sandbox: input.sandbox } : {}),
    ...(input?.approvalPolicy ? { approvalPolicy: input.approvalPolicy } : {}),
    ...(typeof input?.ephemeral === "boolean"
      ? { ephemeral: input.ephemeral }
      : {}),
  });

  if (result.kind !== "createThread") {
    throw new Error(`Unexpected unified command result: ${result.kind}`);
  }

  return CreateThreadResponseSchema.parse({
    threadId: result.threadId,
    thread: result.thread,
  });
}

export async function listCollaborationModes(
  provider: AgentId,
): Promise<z.infer<typeof CollaborationModesResponseSchema>> {
  const result = await runUnifiedCommand({
    kind: "listCollaborationModes",
    provider,
  });

  if (result.kind !== "listCollaborationModes") {
    throw new Error(`Unexpected unified command result: ${result.kind}`);
  }

  return CollaborationModesResponseSchema.parse({
    data: result.data,
  });
}

export async function listModels(
  provider: AgentId,
): Promise<z.infer<typeof ModelsResponseSchema>> {
  const result = await runUnifiedCommand({
    kind: "listModels",
    provider,
    limit: 200,
  });

  if (result.kind !== "listModels") {
    throw new Error(`Unexpected unified command result: ${result.kind}`);
  }

  return ModelsResponseSchema.parse({
    data: result.data,
  });
}

export async function getLiveState(
  threadId: string,
  provider: AgentId,
): Promise<z.infer<typeof LiveStateResponseSchema>> {
  const result = await runUnifiedCommand({
    kind: "readLiveState",
    provider,
    threadId,
  });

  if (result.kind !== "readLiveState") {
    throw new Error(`Unexpected unified command result: ${result.kind}`);
  }

  return LiveStateResponseSchema.parse({
    ok: true,
    threadId: result.threadId,
    ownerClientId: result.ownerClientId,
    conversationState: result.conversationState,
    liveStateError: result.liveStateError ?? null,
  });
}

export async function getStreamEvents(
  threadId: string,
  provider: AgentId,
): Promise<z.infer<typeof StreamEventsResponseSchema>> {
  const result = await runUnifiedCommand({
    kind: "readStreamEvents",
    provider,
    threadId,
    limit: 80,
  });

  if (result.kind !== "readStreamEvents") {
    throw new Error(`Unexpected unified command result: ${result.kind}`);
  }

  return StreamEventsResponseSchema.parse({
    ok: true,
    threadId: result.threadId,
    ownerClientId: result.ownerClientId,
    events: result.events,
  });
}

export async function sendMessage(input: {
  provider: AgentId;
  threadId: string;
  ownerClientId?: string;
  text: string;
  cwd?: string;
  isSteering?: boolean;
}): Promise<void> {
  const result = await runUnifiedCommand({
    kind: "sendMessage",
    provider: input.provider,
    threadId: input.threadId,
    text: input.text,
    ...(input.ownerClientId ? { ownerClientId: input.ownerClientId } : {}),
    ...(input.cwd ? { cwd: input.cwd } : {}),
    ...(typeof input.isSteering === "boolean"
      ? { isSteering: input.isSteering }
      : {}),
  });

  if (result.kind !== "sendMessage") {
    throw new Error(`Unexpected unified command result: ${result.kind}`);
  }
}

export async function setCollaborationMode(input: {
  provider: AgentId;
  threadId: string;
  ownerClientId?: string;
  collaborationMode: {
    mode: string;
    settings: {
      model?: string | null;
      reasoningEffort?: string | null;
      developerInstructions?: string | null;
    };
  };
}): Promise<void> {
  const result = await runUnifiedCommand({
    kind: "setCollaborationMode",
    provider: input.provider,
    threadId: input.threadId,
    ...(input.ownerClientId ? { ownerClientId: input.ownerClientId } : {}),
    collaborationMode: {
      mode: input.collaborationMode.mode,
      settings: {
        ...(input.collaborationMode.settings.model !== undefined
          ? { model: input.collaborationMode.settings.model }
          : {}),
        ...(input.collaborationMode.settings.reasoningEffort !== undefined
          ? {
              reasoningEffort: input.collaborationMode.settings.reasoningEffort,
            }
          : {}),
        ...(input.collaborationMode.settings.developerInstructions !== undefined
          ? {
              developerInstructions:
                input.collaborationMode.settings.developerInstructions,
            }
          : {}),
      },
    },
  });

  if (result.kind !== "setCollaborationMode") {
    throw new Error(`Unexpected unified command result: ${result.kind}`);
  }
}

export async function submitUserInput(input: {
  provider: AgentId;
  threadId: string;
  ownerClientId?: string;
  requestId: z.infer<typeof UnifiedUserInputRequestIdSchema>;
  response: UnifiedThreadRequestResponse;
}): Promise<void> {
  UnifiedThreadRequestResponseSchema.parse(input.response);

  const result = await runUnifiedCommand({
    kind: "submitUserInput",
    provider: input.provider,
    threadId: input.threadId,
    ...(input.ownerClientId ? { ownerClientId: input.ownerClientId } : {}),
    requestId: input.requestId,
    response: input.response,
  });

  if (result.kind !== "submitUserInput") {
    throw new Error(`Unexpected unified command result: ${result.kind}`);
  }
}

export async function interruptThread(input: {
  provider: AgentId;
  threadId: string;
  ownerClientId?: string;
}): Promise<void> {
  const result = await runUnifiedCommand({
    kind: "interrupt",
    provider: input.provider,
    threadId: input.threadId,
    ...(input.ownerClientId ? { ownerClientId: input.ownerClientId } : {}),
  });

  if (result.kind !== "interrupt") {
    throw new Error(`Unexpected unified command result: ${result.kind}`);
  }
}

export async function getTraceStatus(): Promise<
  z.infer<typeof TraceStatusSchema>
> {
  return requestEnvelope("/api/debug/trace/status", TraceStatusSchema);
}

export async function startTrace(label: string): Promise<void> {
  await requestEnvelope(
    "/api/debug/trace/start",
    z.object({ ok: z.literal(true) }).passthrough(),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label }),
    },
  );
}

export async function markTrace(note: string): Promise<void> {
  await requestEnvelope(
    "/api/debug/trace/mark",
    z.object({ ok: z.literal(true) }).passthrough(),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note }),
    },
  );
}

export async function stopTrace(): Promise<void> {
  await requestEnvelope(
    "/api/debug/trace/stop",
    z.object({ ok: z.literal(true) }).passthrough(),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    },
  );
}

export async function listDebugHistory(
  limit = 120,
): Promise<z.infer<typeof HistoryListSchema>> {
  return requestEnvelope(
    `/api/debug/history?limit=${String(limit)}`,
    HistoryListSchema,
  );
}

export async function getHistoryEntry(
  entryId: string,
): Promise<z.infer<typeof HistoryDetailSchema>> {
  return requestEnvelope(
    `/api/debug/history/${encodeURIComponent(entryId)}`,
    HistoryDetailSchema,
  );
}

const AccountRateLimitsEnvelopeSchema = z
  .object({
    ok: z.literal(true),
  })
  .merge(AppServerGetAccountRateLimitsResponseSchema)
  .passthrough();

export async function getAccountRateLimits(): Promise<
  z.infer<typeof AppServerGetAccountRateLimitsResponseSchema>
> {
  const payload = await requestEnvelope(
    "/api/account/rate-limits",
    AccountRateLimitsEnvelopeSchema,
  );

  return AppServerGetAccountRateLimitsResponseSchema.parse({
    rateLimits: payload.rateLimits,
    rateLimitsByLimitId: payload.rateLimitsByLimitId,
  });
}

export function getPendingUserInputRequests(
  conversationState: UnifiedThread | null,
): UnifiedUserInputRequest[] {
  if (!conversationState) {
    return [];
  }

  return conversationState.requests.filter(
    (request): request is UnifiedUserInputRequest =>
      request.method === "item/tool/requestUserInput" &&
      request.completed !== true,
  );
}

export function getPendingThreadRequests(
  conversationState: UnifiedThread | null,
): UnifiedThread["requests"] {
  if (!conversationState) {
    return [];
  }

  return conversationState.requests.filter(
    (request) => request.completed !== true,
  );
}

export function getPendingApprovalRequests(
  conversationState: UnifiedThread | null,
): UnifiedApprovalThreadRequest[] {
  if (!conversationState) {
    return [];
  }

  return conversationState.requests.filter(
    (request): request is UnifiedApprovalThreadRequest =>
      UnifiedApprovalThreadRequestSchema.safeParse(request).success &&
      request.completed !== true,
  );
}

export async function listFeatureMatrix(): Promise<
  z.infer<typeof UnifiedFeatureMatrixSchema>
> {
  const payload = await requestEnvelope(
    "/api/unified/features",
    UnifiedFeaturesEnvelopeSchema,
  );
  return payload.features;
}

export {
  UnifiedFeatureIdSchema,
  UnifiedProviderIdSchema,
  UnifiedUserInputRequestIdSchema,
};

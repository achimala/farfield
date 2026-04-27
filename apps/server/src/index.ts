import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  getCodexServerNotificationMethodMapping,
  getCodexServerRequestMethodMapping,
} from "@farfield/api";
import type {
  AppServerGetAccountRateLimitsResponse,
  AppServerServerNotificationMethod,
  AppServerServerRequestMethod,
  IpcFrame,
} from "@farfield/protocol";
import { Server as SocketServer } from "socket.io";
import { z } from "zod";
import {
  UnifiedCommandSchema,
  UnifiedRealtimeCoreStateSchema,
  UnifiedRealtimeThreadStateSchema,
  type JsonValue,
  type UnifiedEventKind,
  type UnifiedFeatureAvailability,
  type UnifiedFeatureId,
  type UnifiedProviderId,
  type UnifiedThread,
  type UnifiedThreadSummary,
} from "@farfield/unified-surface";
import {
  parseBody,
  TraceMarkBodySchema,
  TraceStartBodySchema,
} from "./http-schemas.js";
import { logger } from "./logger.js";
import {
  parseServerCliOptions,
  formatServerHelpText,
} from "./agents/cli-options.js";
import { AgentRegistry } from "./agents/registry.js";
import { ThreadIndex } from "./agents/thread-index.js";
import {
  CodexAgentAdapter,
  type CodexAppFrameEvent,
} from "./agents/adapters/codex-agent.js";
import { OpenCodeAgentAdapter } from "./agents/adapters/opencode-agent.js";
import type { AgentAdapter } from "./agents/types.js";
import {
  UnifiedBackendFeatureError,
  buildUnifiedFeatureMatrix,
  createUnifiedProviderAdapters,
  mapThread,
} from "./unified/adapter.js";
import { RealtimeCoordinator } from "./realtime/coordinator.js";
import {
  ServerTimingTracker,
  type ServerTimingMetricId,
  type ServerTimingSnapshot,
} from "./perf-metrics.js";

const HOST = process.env["HOST"] ?? "127.0.0.1";
const PORT = Number(process.env["PORT"] ?? 4311);
const HISTORY_LIMIT = 2_000;
const USER_AGENT = "farfield/0.2.2";
const IPC_RECONNECT_DELAY_MS = 1_000;
const SIDEBAR_PREVIEW_MAX_CHARS = 180;
const SIDEBAR_CORE_CACHE_TTL_MS = 1_000;
const RATE_LIMITS_CACHE_TTL_MS = 5_000;
const CORE_RELEVANT_CODEX_NOTIFICATION_METHODS = new Set<
  AppServerServerNotificationMethod
>([
  "thread/archived",
  "thread/closed",
  "thread/compacted",
  "thread/name/updated",
  "thread/started",
  "thread/unarchived",
  "turn/completed",
  "turn/started",
]);

const TRACE_DIR = path.resolve(process.cwd(), "traces");
const DEFAULT_WORKSPACE = path.resolve(process.cwd());

async function timeServerOperation<T>(
  metricId: ServerTimingMetricId,
  task: () => Promise<T>,
): Promise<T> {
  const startedAt = performance.now();
  try {
    return await task();
  } finally {
    timingTracker.record(metricId, performance.now() - startedAt);
  }
}

const IpcParamsConversationIdSchema = z
  .object({
    conversationId: z.string().min(1),
  })
  .passthrough();

const IpcParamsThreadIdSchema = z
  .object({
    threadId: z.string().min(1),
  })
  .passthrough();

interface HistoryEntry {
  id: string;
  at: string;
  source: "ipc" | "app" | "system";
  direction: "in" | "out" | "system";
  payload: unknown;
  meta: Record<string, JsonValue>;
}

interface DebugHistoryListEntry {
  id: string;
  at: string;
  source: HistoryEntry["source"];
  direction: HistoryEntry["direction"];
  meta: HistoryEntry["meta"];
}

interface TraceSummary {
  id: string;
  label: string;
  startedAt: string;
  stoppedAt: string | null;
  eventCount: number;
  path: string;
}

interface ActiveTrace {
  summary: TraceSummary;
  stream: fs.WriteStream;
}

interface RuntimeStateSnapshot {
  appExecutable: string;
  socketPath: string;
  gitCommit: string | null;
  appReady: boolean;
  ipcConnected: boolean;
  ipcInitialized: boolean;
  codexAvailable: boolean;
  lastError: string | null;
  historyCount: number;
  threadOwnerCount: number;
  activeTrace: TraceSummary | null;
  timings: ServerTimingSnapshot;
}

function resolveCodexExecutablePath(): string {
  if (process.env["CODEX_CLI_PATH"]) {
    return process.env["CODEX_CLI_PATH"];
  }

  const desktopPath = "/Applications/Codex.app/Contents/Resources/codex";
  if (fs.existsSync(desktopPath)) {
    return desktopPath;
  }

  return "codex";
}

function resolveIpcSocketPath(): string {
  if (process.env["CODEX_IPC_SOCKET"]) {
    return process.env["CODEX_IPC_SOCKET"];
  }

  if (process.platform === "win32") {
    return "\\\\.\\pipe\\codex-ipc";
  }

  const uid = process.getuid?.() ?? 0;
  return path.join(os.tmpdir(), "codex-ipc", `ipc-${uid}.sock`);
}

function resolveGitCommitHash(): string | null {
  try {
    const hash = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: DEFAULT_WORKSPACE,
      encoding: "utf8",
    }).trim();
    return hash.length > 0 ? hash : null;
  } catch {
    return null;
  }
}

function parseInteger(value: string | null, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function parseBoolean(value: string | null, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }

  if (value === "1" || value === "true") {
    return true;
  }

  if (value === "0" || value === "false") {
    return false;
  }

  return fallback;
}

function jsonResponse(
  res: ServerResponse,
  statusCode: number,
  body: unknown,
): void {
  const encoded = Buffer.from(JSON.stringify(body), "utf8");
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": encoded.length,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  });
  res.end(encoded);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    if (typeof chunk === "string") {
      chunks.push(Buffer.from(chunk, "utf8"));
      continue;
    }
    chunks.push(chunk as Buffer);
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return {};
  }

  return JSON.parse(raw);
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return String(error);
}

function compactSidebarPreview(preview: string): string {
  const compact = preview.replace(/\s+/g, " ").trim();
  if (compact.length <= SIDEBAR_PREVIEW_MAX_CHARS) {
    return compact;
  }
  const sliceLength = Math.max(0, SIDEBAR_PREVIEW_MAX_CHARS - 3);
  return `${compact.slice(0, sliceLength).trimEnd()}...`;
}

function toDebugHistoryListEntry(entry: HistoryEntry): DebugHistoryListEntry {
  return {
    id: entry.id,
    at: entry.at,
    source: entry.source,
    direction: entry.direction,
    meta: entry.meta,
  };
}

function ensureTraceDirectory(): void {
  if (!fs.existsSync(TRACE_DIR)) {
    fs.mkdirSync(TRACE_DIR, { recursive: true });
  }
}

const parsedCli = (() => {
  try {
    return parseServerCliOptions(process.argv.slice(2));
  } catch (error) {
    const message = toErrorMessage(error);
    process.stderr.write(`${message}\n`);
    process.stderr.write("Run with --help to see valid arguments.\n");
    process.exit(1);
  }
})();

if (parsedCli.showHelp) {
  process.stdout.write(formatServerHelpText());
  process.stdout.write("\n");
  process.exit(0);
}

const configuredAgentIds = parsedCli.agentIds;
const configuredUnifiedProviders: UnifiedProviderId[] = [...configuredAgentIds];
const codexExecutable = resolveCodexExecutablePath();
const ipcSocketPath = resolveIpcSocketPath();
const gitCommit = resolveGitCommitHash();

const history: HistoryEntry[] = [];
const historyById = new Map<string, unknown>();
const activeSockets = new Set<Socket>();
const threadIndex = new ThreadIndex();

let activeTrace: ActiveTrace | null = null;
const recentTraces: TraceSummary[] = [];
let runtimeLastError: string | null = null;
const timingTracker = new ServerTimingTracker();

function recordTraceEvent(event: unknown): void {
  if (!activeTrace) {
    return;
  }

  activeTrace.summary.eventCount += 1;
  activeTrace.stream.write(`${JSON.stringify(event)}\n`);
}

function pushHistory(
  source: HistoryEntry["source"],
  direction: HistoryEntry["direction"],
  payload: unknown,
  meta: Record<string, JsonValue> = {},
): HistoryEntry {
  const entry: HistoryEntry = {
    id: randomUUID(),
    at: new Date().toISOString(),
    source,
    direction,
    payload,
    meta,
  };

  history.push(entry);
  historyById.set(entry.id, payload);

  if (history.length > HISTORY_LIMIT) {
    const removed = history.shift();
    if (removed) {
      historyById.delete(removed.id);
    }
  }

  recordTraceEvent({ type: "history", ...entry });
  queueDebugDelta?.();
  return entry;
}

function pushSystem(
  message: string,
  details: Record<string, JsonValue> = {},
): void {
  logger.info({ message, ...details }, "system-event");
  pushHistory("system", "system", { message, details });
}

let codexAdapter: CodexAgentAdapter | null = null;
let openCodeAdapter: OpenCodeAgentAdapter | null = null;
const adapters: AgentAdapter[] = [];
let queueCoreDelta: (() => void) | null = null;
let queueDebugDelta: (() => void) | null = null;
let queueThreadDelta: ((threadId: string) => void) | null = null;
let broadcastSyncError: ((message: string, code?: string) => void) | null =
  null;

for (const agentId of configuredAgentIds) {
  if (agentId === "codex") {
    codexAdapter = new CodexAgentAdapter({
      appExecutable: codexExecutable,
      socketPath: ipcSocketPath,
      workspaceDir: DEFAULT_WORKSPACE,
      userAgent: USER_AGENT,
      reconnectDelayMs: IPC_RECONNECT_DELAY_MS,
      onRuntimeStateChange: () => {
        queueCoreDelta?.();
      },
      onThreadStateChange: (threadId) => {
        queueThreadDelta?.(threadId);
      },
      onTiming: (metricId, durationMs) => {
        timingTracker.record(metricId, durationMs);
      },
    });

    codexAdapter.onIpcFrame((event) => {
      pushHistory("ipc", event.direction, event.frame, {
        method: event.method,
        threadId: event.threadId,
      });
      queueDebugDelta?.();
      if (event.direction === "in") {
        classifyCodexFrameForRealtime(event.frame);
      }
    });

    codexAdapter.onAppFrame((event) => {
      pushHistory("app", event.direction, event.frame, {
        kind: event.kind,
        method: event.method,
        threadId: event.threadId,
      });
      queueDebugDelta?.();
      classifyCodexAppFrameForRealtime(event);
    });

    adapters.push(codexAdapter);
    continue;
  }

  if (agentId === "opencode") {
    openCodeAdapter = new OpenCodeAgentAdapter();
    openCodeAdapter.onEvent((event) => {
      if (event.kind === "streamError") {
        broadcastSyncError?.(event.message, "opencodeStreamError");
        queueCoreDelta?.();
        return;
      }

      queueCoreDelta?.();
      queueDebugDelta?.();
      if (event.relatedThreadId) {
        queueThreadDelta?.(event.relatedThreadId);
      }
    });
    adapters.push(openCodeAdapter);
  }
}

const registry = new AgentRegistry(adapters);
const unifiedAdapters = createUnifiedProviderAdapters({
  codex: codexAdapter,
  opencode: openCodeAdapter,
});

function getRuntimeStateSnapshot(): RuntimeStateSnapshot {
  const codexRuntimeState = codexAdapter?.getRuntimeState();

  return {
    appExecutable: codexExecutable,
    socketPath: ipcSocketPath,
    gitCommit,
    appReady: codexRuntimeState?.appReady ?? false,
    ipcConnected: codexRuntimeState?.ipcConnected ?? false,
    ipcInitialized: codexRuntimeState?.ipcInitialized ?? false,
    codexAvailable: codexRuntimeState?.codexAvailable ?? false,
    lastError: runtimeLastError ?? codexRuntimeState?.lastError ?? null,
    historyCount: history.length,
    threadOwnerCount: codexAdapter?.getThreadOwnerCount() ?? 0,
    activeTrace: activeTrace?.summary ?? null,
    timings: timingTracker.snapshot(),
  };
}

function resolveUnifiedAdapter(provider: UnifiedProviderId) {
  return unifiedAdapters[provider];
}

function listUnifiedProviders(): UnifiedProviderId[] {
  return configuredUnifiedProviders;
}

interface DiscoveredUnifiedThread {
  provider: UnifiedProviderId;
  thread: UnifiedThread;
}

async function readUnifiedThreadDirect(input: {
  provider: UnifiedProviderId;
  threadId: string;
  includeTurns: boolean;
}): Promise<UnifiedThread> {
  const agent = registry.getAdapter(input.provider);
  if (!agent || !agent.isEnabled()) {
    throw new UnifiedBackendFeatureError(
      input.provider,
      "readThread",
      "providerDisabled",
    );
  }

  const result = await agent.readThread({
    threadId: input.threadId,
    includeTurns: input.includeTurns,
  });
  return mapThread(input.provider, result.thread);
}

async function discoverUnifiedThreads(input: {
  threadId: string;
  includeTurns: boolean;
}): Promise<DiscoveredUnifiedThread[]> {
  const matches = await Promise.all(
    listUnifiedProviders().map(
      async (provider): Promise<DiscoveredUnifiedThread | null> => {
        try {
          const thread = await readUnifiedThreadDirect({
            provider,
            threadId: input.threadId,
            includeTurns: input.includeTurns,
          });
          threadIndex.register(thread.id, thread.provider);
          return {
            provider,
            thread,
          };
        } catch {
          return null;
        }
      },
    ),
  );

  return matches.filter(
    (match): match is DiscoveredUnifiedThread => match !== null,
  );
}

interface ProviderErrorPayload {
  code: string;
  message: string;
  details?: Record<string, string>;
}

interface UnifiedListThreadsResponse {
  data: UnifiedThreadSummary[];
  cursors: Record<UnifiedProviderId, string | null>;
  errors: Record<UnifiedProviderId, ProviderErrorPayload | null>;
}

interface UnifiedSidebarResponse {
  rows: UnifiedThreadSummary[];
  errors: Record<UnifiedProviderId, ProviderErrorPayload | null>;
}

interface UnifiedThreadListInput {
  limit: number;
  archived: boolean;
  all: boolean;
  maxPages: number;
  cursor: string | null;
}

interface SidebarCacheEntry {
  expiresAtMs: number;
  value: UnifiedSidebarResponse;
}

interface RateLimitsCacheEntry {
  expiresAtMs: number;
  value: AppServerGetAccountRateLimitsResponse;
}

const sidebarCacheByKey = new Map<string, SidebarCacheEntry>();
const sidebarInFlightByKey = new Map<string, Promise<UnifiedSidebarResponse>>();
let rateLimitsCacheEntry: RateLimitsCacheEntry | null = null;
let rateLimitsInFlight: Promise<AppServerGetAccountRateLimitsResponse> | null =
  null;

function providerLabel(provider: UnifiedProviderId): string {
  return provider === "codex" ? "Codex" : "OpenCode";
}

function buildUnavailableProviderError(
  provider: UnifiedProviderId,
  featureId: UnifiedFeatureId,
  availability: Extract<
    UnifiedFeatureAvailability,
    { status: "unavailable" }
  >,
): ProviderErrorPayload {
  const label = providerLabel(provider);
  const message = (() => {
    switch (availability.reason) {
      case "providerDisconnected":
        return `${label} is not connected. Open ${label} and retry.`;
      case "providerNotReady":
        return `${label} is not ready yet.`;
      case "providerDisabled":
        return `${label} is disabled.`;
      case "unsupportedByProvider":
        return `${label} does not support ${featureId}.`;
      case "requiresOwnerClientId":
        return `${label} needs an owner client for ${featureId}.`;
    }
  })();

  return {
    code: availability.reason,
    message: availability.detail ?? message,
    details: {
      provider,
      featureId,
      reason: availability.reason,
    },
  };
}

function isFeatureAvailable(feature: UnifiedFeatureAvailability): boolean {
  return feature.status === "available";
}

function buildAgentCapabilities(
  features: Record<UnifiedFeatureId, UnifiedFeatureAvailability>,
): {
  canListModels: boolean;
  canListCollaborationModes: boolean;
  canSetCollaborationMode: boolean;
  canSubmitUserInput: boolean;
  canReadLiveState: boolean;
  canReadStreamEvents: boolean;
  canListProjectDirectories: boolean;
} {
  return {
    canListModels: isFeatureAvailable(features.listModels),
    canListCollaborationModes: isFeatureAvailable(
      features.listCollaborationModes,
    ),
    canSetCollaborationMode: isFeatureAvailable(features.setCollaborationMode),
    canSubmitUserInput: isFeatureAvailable(features.submitUserInput),
    canReadLiveState: isFeatureAvailable(features.readLiveState),
    canReadStreamEvents: isFeatureAvailable(features.readStreamEvents),
    canListProjectDirectories: isFeatureAvailable(features.listProjectDirectories),
  };
}

async function listUnifiedThreads(
  input: UnifiedThreadListInput,
): Promise<UnifiedListThreadsResponse> {
  const data: UnifiedThreadSummary[] = [];
  const cursors: Record<UnifiedProviderId, string | null> = {
    codex: null,
    opencode: null,
  };
  const errors: Record<UnifiedProviderId, ProviderErrorPayload | null> = {
    codex: null,
    opencode: null,
  };

  await Promise.all(
    listUnifiedProviders().map(async (provider) => {
      const adapter = resolveUnifiedAdapter(provider);
      if (!adapter) {
        errors[provider] = {
          code: "providerDisabled",
          message: `Provider ${provider} is not available`,
        };
        return;
      }

      const availability = adapter.getFeatureAvailability().listThreads;
      if (availability.status === "unavailable") {
        if (
          availability.reason === "providerDisconnected" ||
          availability.reason === "providerNotReady"
        ) {
          adapter.requestConnectionCheck();
        }
        errors[provider] = buildUnavailableProviderError(
          provider,
          "listThreads",
          availability,
        );
        return;
      }

      try {
        const result = await adapter.execute({
          kind: "listThreads",
          provider,
          limit: input.limit,
          archived: input.archived,
          all: input.all,
          maxPages: input.maxPages,
          cursor: input.cursor,
        });

        cursors[provider] = result.nextCursor ?? null;
        for (const thread of result.data) {
          threadIndex.register(thread.id, thread.provider);
          data.push(thread);
        }
      } catch (error) {
        const message = toErrorMessage(error);
        errors[provider] = {
          code: "listThreadsFailed",
          message,
          details: {
            provider,
          },
        };
        logger.warn(
          {
            provider,
            error: message,
          },
          "unified-list-threads-failed",
        );
      }
    }),
  );

  return {
    data,
    cursors,
    errors,
  };
}

async function listUnifiedSidebarThreads(
  input: UnifiedThreadListInput,
): Promise<UnifiedSidebarResponse> {
  const result = await listUnifiedThreads(input);
  return {
    rows: result.data.map((thread) => ({
      ...thread,
      preview: compactSidebarPreview(thread.preview),
    })),
    errors: result.errors,
  };
}

function buildSidebarCacheKey(input: UnifiedThreadListInput): string {
  return [
    String(input.limit),
    input.archived ? "archived" : "active",
    input.all ? "all" : "recent",
    String(input.maxPages),
    input.cursor ?? "",
  ].join(":");
}

async function listUnifiedSidebarThreadsShared(
  input: UnifiedThreadListInput,
): Promise<UnifiedSidebarResponse> {
  const key = buildSidebarCacheKey(input);
  const nowMs = Date.now();
  const cached = sidebarCacheByKey.get(key);
  if (cached && cached.expiresAtMs > nowMs) {
    return cached.value;
  }

  const inFlight = sidebarInFlightByKey.get(key);
  if (inFlight) {
    return inFlight;
  }

  const promise = listUnifiedSidebarThreads(input)
    .then((value) => {
      sidebarCacheByKey.set(key, {
        expiresAtMs: Date.now() + SIDEBAR_CORE_CACHE_TTL_MS,
        value,
      });
      return value;
    })
    .finally(() => {
      sidebarInFlightByKey.delete(key);
    });
  sidebarInFlightByKey.set(key, promise);
  return promise;
}

async function buildRealtimeCoreState() {
  const startedAt = performance.now();
  try {
    const [sidebar, rateLimits, features] = await Promise.all([
      timeServerOperation("realtimeCoreSidebarList", () =>
        listUnifiedSidebarThreadsShared({
          limit: 80,
          archived: false,
          all: false,
          maxPages: 1,
          cursor: null,
        }),
      ),
      timeServerOperation("realtimeCoreRateLimits", () =>
        readRateLimitsForRealtime(),
      ),
      Promise.resolve(
        buildUnifiedFeatureMatrix({
          codex: codexAdapter,
          opencode: openCodeAdapter,
        }),
      ),
    ]);

    const agents = await timeServerOperation(
      "realtimeCoreAgentsBuild",
      async () =>
        Promise.all(
          listUnifiedProviders().map(async (provider) => {
            const providerFeatures = features[provider];
            const enabled = registry.getAdapter(provider)?.isEnabled() ?? false;
            const connected = registry.getAdapter(provider)?.isConnected() ?? false;
            const adapter = resolveUnifiedAdapter(provider);
            let projectDirectories: string[] = [];

            if (
              adapter &&
              isFeatureAvailable(providerFeatures.listProjectDirectories)
            ) {
              try {
                const result = await adapter.execute({
                  kind: "listProjectDirectories",
                  provider,
                });
                projectDirectories = result.directories;
              } catch {
                projectDirectories = [];
              }
            }

            return {
              id: provider,
              label: provider === "codex" ? "Codex" : "OpenCode",
              enabled,
              connected,
              features: providerFeatures,
              capabilities: buildAgentCapabilities(providerFeatures),
              projectDirectories,
            };
          }),
        ),
    );

    const defaultAgentId = agents.find((agent) => agent.enabled)?.id ?? "codex";
    const traceStatus = {
      active: activeTrace?.summary ?? null,
      recent: recentTraces,
    };
    const historyList = history.slice(-120).map(toDebugHistoryListEntry);
    const runtimeState = getRuntimeStateSnapshot();

    return UnifiedRealtimeCoreStateSchema.parse({
      health: {
        appReady: runtimeState.appReady,
        ipcConnected: runtimeState.ipcConnected,
        ipcInitialized: runtimeState.ipcInitialized,
        gitCommit: runtimeState.gitCommit,
        lastError: runtimeState.lastError,
        historyCount: runtimeState.historyCount,
        threadOwnerCount: runtimeState.threadOwnerCount,
        timings: runtimeState.timings,
      },
      agents: {
        agents,
        defaultAgentId,
      },
      sidebar,
      rateLimits,
      traceStatus,
      history: historyList,
    });
  } finally {
    timingTracker.record("realtimeCoreBuild", performance.now() - startedAt);
  }
}

async function buildRealtimeThreadState(input: {
  threadId: string;
  includeStreamEvents: boolean;
}) {
  const startedAt = performance.now();
  try {
    const knownProviders = threadIndex.providers(input.threadId);
    let provider = threadIndex.resolve(input.threadId);
    let discoveredThread: UnifiedThread | null = null;

    if (!provider) {
      if (knownProviders.length > 1) {
        return null;
      }

      const discoveredMatches = await discoverUnifiedThreads({
        threadId: input.threadId,
        includeTurns: true,
      });
      if (discoveredMatches.length !== 1) {
        return null;
      }

      provider = discoveredMatches[0]?.provider ?? null;
      discoveredThread = discoveredMatches[0]?.thread ?? null;
      if (!provider) {
        return null;
      }
    }

    const adapter = resolveUnifiedAdapter(provider);
    if (!adapter) {
      return null;
    }

    let liveResult:
      | Awaited<ReturnType<typeof adapter.execute>>
      | {
          kind: "readLiveState";
          threadId: string;
          ownerClientId: null;
          conversationState: null;
          liveStateError: null;
        };
    try {
      liveResult =
        adapter.getFeatureAvailability().readLiveState.status === "available"
          ? await adapter.execute({
              kind: "readLiveState",
              provider,
              threadId: input.threadId,
            })
          : {
              kind: "readLiveState" as const,
              threadId: input.threadId,
              ownerClientId: null,
              conversationState: null,
              liveStateError: null,
            };
    } catch (error) {
      if (
        error instanceof UnifiedBackendFeatureError &&
        error.provider === provider &&
        error.featureId === "readLiveState" &&
        error.reason === "providerDisconnected"
      ) {
        return null;
      }
      throw error;
    }
    if (liveResult.kind !== "readLiveState") {
      return null;
    }

    let readThread = liveResult.conversationState;
    if (!readThread) {
      if (discoveredThread) {
        readThread = discoveredThread;
      } else {
        let readResult: Awaited<ReturnType<typeof adapter.execute>>;
        try {
          readResult = await adapter.execute({
            kind: "readThread",
            provider,
            threadId: input.threadId,
            includeTurns: true,
          });
        } catch (error) {
          if (
            error instanceof UnifiedBackendFeatureError &&
            error.provider === provider &&
            error.featureId === "readThread" &&
            error.reason === "providerDisconnected"
          ) {
            return null;
          }
          throw error;
        }

        if (readResult.kind !== "readThread") {
          return null;
        }

        readThread = readResult.thread;
      }
    }

    threadIndex.register(readThread.id, readThread.provider);

    let streamResult:
      | Awaited<ReturnType<typeof adapter.execute>>
      | {
          kind: "readStreamEvents";
          threadId: string;
          ownerClientId: null;
          events: [];
        };
    try {
      streamResult =
        input.includeStreamEvents &&
        adapter.getFeatureAvailability().readStreamEvents.status === "available"
          ? await adapter.execute({
              kind: "readStreamEvents",
              provider,
              threadId: input.threadId,
              limit: 80,
            })
          : {
              kind: "readStreamEvents" as const,
              threadId: input.threadId,
              ownerClientId: null,
              events: [],
            };
    } catch (error) {
      if (
        error instanceof UnifiedBackendFeatureError &&
        error.provider === provider &&
        error.featureId === "readStreamEvents" &&
        error.reason === "providerDisconnected"
      ) {
        return null;
      }
      throw error;
    }
    if (streamResult.kind !== "readStreamEvents") {
      return null;
    }

    return UnifiedRealtimeThreadStateSchema.parse({
      threadId: input.threadId,
      readThread,
      liveState: {
        ownerClientId: liveResult.ownerClientId,
        conversationState: liveResult.conversationState,
        liveStateError: liveResult.liveStateError ?? null,
      },
      streamEvents: streamResult.events,
    });
  } finally {
    timingTracker.record("realtimeThreadBuild", performance.now() - startedAt);
  }
}

async function buildRealtimeDebugState() {
  return {
    traceStatus: {
      active: activeTrace?.summary ?? null,
      recent: recentTraces,
    },
    history: history.slice(-120).map(toDebugHistoryListEntry),
  };
}

async function readRateLimitsSafe():
  Promise<AppServerGetAccountRateLimitsResponse | null> {
  try {
    return await readRateLimitsShared();
  } catch {
    return null;
  }
}

async function readRateLimitsForRealtime():
  Promise<AppServerGetAccountRateLimitsResponse | null> {
  const nowMs = Date.now();
  if (rateLimitsCacheEntry && rateLimitsCacheEntry.expiresAtMs > nowMs) {
    return rateLimitsCacheEntry.value;
  }

  void readRateLimitsShared()
    .then(() => {
      queueCoreDelta?.();
    })
    .catch(() => undefined);
  return null;
}

async function readRateLimitsShared():
  Promise<AppServerGetAccountRateLimitsResponse> {
  const nowMs = Date.now();
  if (rateLimitsCacheEntry && rateLimitsCacheEntry.expiresAtMs > nowMs) {
    return rateLimitsCacheEntry.value;
  }

  if (rateLimitsInFlight) {
    return rateLimitsInFlight;
  }

  const adapter = registry.resolveFirstWithCapability("canReadRateLimits");
  if (!adapter || !adapter.readRateLimits) {
    throw new Error("No agent supports rate limit reading");
  }

  rateLimitsInFlight = adapter
    .readRateLimits()
    .then((value) => {
      rateLimitsCacheEntry = {
        expiresAtMs: Date.now() + RATE_LIMITS_CACHE_TTL_MS,
        value,
      };
      return value;
    })
    .finally(() => {
      rateLimitsInFlight = null;
    });
  return rateLimitsInFlight;
}

function classifyCodexFrameForRealtime(frame: IpcFrame): void {
  if (frame.type === "request") {
    try {
      const mapping = getCodexServerRequestMethodMapping(
        frame.method as AppServerServerRequestMethod,
      );
      if (mapping.status === "exposed") {
        if (shouldQueueCoreDeltaForCodexRequest()) {
          queueCoreDelta?.();
        }
        if (mapping.eventKind === "error") {
          broadcastSyncError?.(
            `Codex request event reported error for method ${frame.method}`,
            "codexEventError",
          );
        }
        const threadId = extractThreadIdFromIpcFrame(frame);
        if (threadId) {
          queueThreadDelta?.(threadId);
        }
      }
      return;
    } catch {
      return;
    }
  }

  if (frame.type === "broadcast") {
    try {
      const mapping = getCodexServerNotificationMethodMapping(
        frame.method as AppServerServerNotificationMethod,
      );
      if (mapping.status === "exposed") {
        if (
          shouldQueueCoreDeltaForCodexNotification(
            frame.method as AppServerServerNotificationMethod,
            mapping.eventKind,
          )
        ) {
          queueCoreDelta?.();
        }
        if (mapping.eventKind === "error") {
          broadcastSyncError?.(
            `Codex notification reported error for method ${frame.method}`,
            "codexEventError",
          );
        }
        const threadId = extractThreadIdFromIpcFrame(frame);
        if (threadId) {
          queueThreadDelta?.(threadId);
        }
      }
    } catch {
      return;
    }
  }
}

function classifyCodexAppFrameForRealtime(event: CodexAppFrameEvent): void {
  if (event.kind === "request") {
    const mapping = getCodexServerRequestMethodMapping(
      event.frame.method as AppServerServerRequestMethod,
    );
    if (mapping.status !== "exposed") {
      return;
    }
    if (shouldQueueCoreDeltaForCodexRequest()) {
      queueCoreDelta?.();
    }
    if (mapping.eventKind === "error") {
      broadcastSyncError?.(
        `Codex app request reported error for method ${event.frame.method}`,
        "codexEventError",
      );
    }
    if (event.threadId) {
      queueThreadDelta?.(event.threadId);
    }
    return;
  }

  const mapping = getCodexServerNotificationMethodMapping(
    event.frame.method as AppServerServerNotificationMethod,
  );
  if (mapping.status !== "exposed") {
    return;
  }
  if (
    shouldQueueCoreDeltaForCodexNotification(
      event.frame.method,
      mapping.eventKind,
    )
  ) {
    queueCoreDelta?.();
  }
  if (mapping.eventKind === "error") {
    broadcastSyncError?.(
      `Codex app notification reported error for method ${event.frame.method}`,
      "codexEventError",
    );
  }
  if (event.threadId) {
    queueThreadDelta?.(event.threadId);
  }
}

function shouldQueueCoreDeltaForCodexRequest(): boolean {
  return false;
}

function shouldQueueCoreDeltaForCodexNotification(
  method: AppServerServerNotificationMethod,
  eventKind: UnifiedEventKind,
): boolean {
  if (eventKind === "providerStateChanged" || eventKind === "error") {
    return true;
  }

  return CORE_RELEVANT_CODEX_NOTIFICATION_METHODS.has(method);
}

function extractThreadIdFromIpcFrame(frame: IpcFrame): string | null {
  if (frame.type !== "request" && frame.type !== "broadcast") {
    return null;
  }

  const conversationId = IpcParamsConversationIdSchema.safeParse(frame.params);
  if (conversationId.success) {
    return conversationId.data.conversationId;
  }

  const threadId = IpcParamsThreadIdSchema.safeParse(frame.params);
  if (threadId.success) {
    return threadId.data.threadId;
  }

  return null;
}

function printStartupBanner(): void {
  const supportsColor =
    process.stdout.isTTY &&
    process.env["NO_COLOR"] !== "1" &&
    process.env["TERM"] !== "dumb";
  const color = {
    reset: "\u001B[0m",
    bold: "\u001B[1m",
    dim: "\u001B[2m",
    green: "\u001B[32m",
    cyan: "\u001B[36m",
    yellow: "\u001B[33m",
    blue: "\u001B[34m",
    underline: "\u001B[4m",
  } as const;
  const paint = (
    text: string,
    tone: keyof typeof color,
    options?: { bold?: boolean; underline?: boolean },
  ): string => {
    if (!supportsColor) {
      return text;
    }
    const prefixes: string[] = [color[tone]];
    if (options?.bold) {
      prefixes.push(color.bold);
    }
    if (options?.underline) {
      prefixes.push(color.underline);
    }
    return `${prefixes.join("")}${text}${color.reset}`;
  };
  const rule = supportsColor
    ? paint("=".repeat(68), "dim")
    : "=".repeat(68);
  const lines = [
    "",
    rule,
    paint("Farfield Server", "green", { bold: true }),
    paint(`Local URL: http://${HOST}:${PORT}`, "cyan", { bold: true }),
    paint("Open this now: https://farfield.app", "blue", {
      bold: true,
      underline: true,
    }),
    paint(`Agents: ${configuredAgentIds.join(", ")}`, "dim"),
    "",
    paint("Remote access (recommended):", "yellow", { bold: true }),
    "1. Keep this server private. Do not expose it to the public internet.",
    "2. Put it behind a VPN, such as Tailscale.",
    "3. In farfield.app, open Settings and set your server URL.",
    "",
    paint("Setup guide:", "cyan", { bold: true }),
    paint("https://github.com/achimala/farfield#readme", "blue", {
      underline: true,
    }),
    "",
    paint("Press Control+C to stop.", "dim", { bold: true }),
    rule,
    "",
  ];
  process.stdout.write(lines.join("\n"));
}

function parseUnifiedProviderId(
  value: string | null,
): UnifiedProviderId | null {
  if (value === "codex" || value === "opencode") {
    return value;
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  try {
    if (!req.url) {
      jsonResponse(res, 400, { ok: false, error: "Missing request URL" });
      return;
    }

    if (req.method === "OPTIONS") {
      jsonResponse(res, 204, {});
      return;
    }

    const url = new URL(req.url, `http://${HOST}:${PORT}`);
    const pathname = url.pathname;
    const segments = pathname.split("/").filter(Boolean);

    if (req.method === "GET" && pathname === "/api/health") {
      jsonResponse(res, 200, {
        ok: true,
        state: getRuntimeStateSnapshot(),
      });
      return;
    }

    if (req.method === "GET" && pathname === "/api/unified/features") {
      const features = buildUnifiedFeatureMatrix({
        codex: codexAdapter,
        opencode: openCodeAdapter,
      });

      jsonResponse(res, 200, {
        ok: true,
        features,
      });
      return;
    }

    if (req.method === "POST" && pathname === "/api/unified/command") {
      const command = UnifiedCommandSchema.parse(await readJsonBody(req));
      const adapter = resolveUnifiedAdapter(command.provider);

      if (!adapter) {
        jsonResponse(res, 503, {
          ok: false,
          error: {
            code: "providerDisabled",
            message: `Provider ${command.provider} is not available`,
          },
        });
        return;
      }

      try {
        const result = await adapter.execute(command);

        if (result.kind === "listThreads") {
          for (const thread of result.data) {
            threadIndex.register(thread.id, thread.provider);
          }
        }

        if (result.kind === "readThread" || result.kind === "createThread") {
          threadIndex.register(result.thread.id, result.thread.provider);
          queueThreadDelta?.(result.thread.id);
          queueCoreDelta?.();
        }

        jsonResponse(res, 200, {
          ok: true,
          result,
        });
      } catch (error) {
        if (error instanceof UnifiedBackendFeatureError) {
          jsonResponse(res, 200, {
            ok: false,
            error: {
              code: error.reason,
              message: error.message,
              details: {
                provider: error.provider,
                featureId: error.featureId,
                reason: error.reason,
              },
            },
          });
          return;
        }

        const message = toErrorMessage(error);
        broadcastSyncError?.(message, "internalError");
        queueCoreDelta?.();
        jsonResponse(res, 500, {
          ok: false,
          error: {
            code: "internalError",
            message,
          },
        });
      }
      return;
    }

    if (req.method === "GET" && pathname === "/api/unified/threads") {
      const limit = parseInteger(url.searchParams.get("limit"), 80);
      const archived = parseBoolean(url.searchParams.get("archived"), false);
      const all = parseBoolean(url.searchParams.get("all"), false);
      const maxPages = parseInteger(url.searchParams.get("maxPages"), 20);
      const cursor = url.searchParams.get("cursor") ?? null;
      const result = await listUnifiedThreads({
        limit,
        archived,
        all,
        maxPages,
        cursor,
      });
      jsonResponse(res, 200, {
        ok: true,
        data: result.data,
        cursors: result.cursors,
        errors: result.errors,
      });
      return;
    }

    if (req.method === "GET" && pathname === "/api/unified/sidebar") {
      const limit = parseInteger(url.searchParams.get("limit"), 80);
      const archived = parseBoolean(url.searchParams.get("archived"), false);
      const all = parseBoolean(url.searchParams.get("all"), false);
      const maxPages = parseInteger(url.searchParams.get("maxPages"), 20);
      const cursor = url.searchParams.get("cursor") ?? null;
      const result = await listUnifiedSidebarThreadsShared({
        limit,
        archived,
        all,
        maxPages,
        cursor,
      });
      jsonResponse(res, 200, {
        ok: true,
        rows: result.rows,
        errors: result.errors,
      });
      return;
    }

    if (
      req.method === "GET" &&
      segments[0] === "api" &&
      segments[1] === "unified" &&
      segments[2] === "thread" &&
      segments[3]
    ) {
      const threadId = decodeURIComponent(segments[3]);
      const rawProvider = url.searchParams.get("provider");
      const providerFromQuery = parseUnifiedProviderId(rawProvider);
      if (rawProvider !== null && providerFromQuery === null) {
        jsonResponse(res, 400, {
          ok: false,
          error: {
            code: "invalidProvider",
            message: `Provider ${rawProvider} is not supported`,
            details: {
              provider: rawProvider,
            },
          },
        });
        return;
      }
      const includeTurns = parseBoolean(
        url.searchParams.get("includeTurns"),
        true,
      );
      const knownProviders = threadIndex.providers(threadId);
      const resolvedProvider = threadIndex.resolve(threadId);
      let provider = providerFromQuery ?? resolvedProvider;
      let discoveredThread: UnifiedThread | null = null;

      if (!provider) {
        if (knownProviders.length > 1) {
          jsonResponse(res, 409, {
            ok: false,
            error: {
              code: "threadProviderAmbiguous",
              message: `Thread ${threadId} exists in multiple providers; provider query is required`,
              details: {
                threadId,
                providers: knownProviders,
              },
            },
          });
          return;
        }

        const discoveredMatches = await discoverUnifiedThreads({
          threadId,
          includeTurns,
        });
        if (discoveredMatches.length > 1) {
          jsonResponse(res, 409, {
            ok: false,
            error: {
              code: "threadProviderAmbiguous",
              message: `Thread ${threadId} exists in multiple providers; provider query is required`,
              details: {
                threadId,
                providers: discoveredMatches.map((match) => match.provider),
              },
            },
          });
          return;
        }

        if (discoveredMatches.length === 1) {
          provider = discoveredMatches[0]?.provider ?? null;
          discoveredThread = discoveredMatches[0]?.thread ?? null;
        }

        if (!provider || !discoveredThread) {
          const enabledButDisconnectedProvider = listUnifiedProviders().find(
            (providerId) => {
              const providerAdapter = registry.getAdapter(providerId);
              return (
                providerAdapter?.isEnabled() === true &&
                providerAdapter.isConnected() === false
              );
            },
          );
          if (enabledButDisconnectedProvider) {
            jsonResponse(res, 503, {
              ok: false,
              error: {
                code: "providerDisconnected",
                message: `Provider ${enabledButDisconnectedProvider} is not ready yet`,
                details: {
                  provider: enabledButDisconnectedProvider,
                  threadId,
                },
              },
            });
            return;
          }

          jsonResponse(res, 404, {
            ok: false,
            error: {
              code: "threadNotFound",
              message: `Thread ${threadId} is not registered`,
              details: {
                threadId,
              },
            },
          });
          return;
        }
      }

      const providerAdapter = registry.getAdapter(provider);
      if (!providerAdapter || !providerAdapter.isEnabled()) {
        jsonResponse(res, 503, {
          ok: false,
          error: {
            code: "providerDisabled",
            message: `Provider ${provider} is not available`,
            details: {
              provider,
            },
          },
        });
        return;
      }

      try {
        const thread =
          discoveredThread && discoveredThread.provider === provider
            ? discoveredThread
            : await readUnifiedThreadDirect({
                provider,
                threadId,
                includeTurns,
              });

        threadIndex.register(thread.id, thread.provider);
        jsonResponse(res, 200, {
          ok: true,
          thread,
        });
      } catch (error) {
        const message = toErrorMessage(error);
        jsonResponse(res, 500, {
          ok: false,
          error: {
            code: "threadReadFailed",
            message,
            details: {
              provider,
              threadId,
              includeTurns,
            },
          },
        });
      }
      return;
    }

    if (segments[0] === "api" && segments[1] === "debug") {
      if (req.method === "GET" && segments[2] === "history" && segments[3]) {
        const entryId = decodeURIComponent(segments[3]);
        const entry = history.find((item) => item.id === entryId) ?? null;
        if (!entry) {
          jsonResponse(res, 404, {
            ok: false,
            error: "History entry not found",
          });
          return;
        }

        jsonResponse(res, 200, {
          ok: true,
          entry: toDebugHistoryListEntry(entry),
          fullPayloadJson: JSON.stringify(historyById.get(entryId) ?? null, null, 2),
        });
        return;
      }

      if (req.method === "GET" && segments[2] === "history") {
        const limit = parseInteger(url.searchParams.get("limit"), 120);
        const data = history.slice(-limit).map(toDebugHistoryListEntry);
        jsonResponse(res, 200, { ok: true, history: data });
        return;
      }

      if (req.method === "GET" && pathname === "/api/debug/trace/status") {
        jsonResponse(res, 200, {
          ok: true,
          active: activeTrace?.summary ?? null,
          recent: recentTraces,
        });
        return;
      }

      if (req.method === "POST" && pathname === "/api/debug/trace/start") {
        const body = parseBody(TraceStartBodySchema, await readJsonBody(req));
        if (activeTrace) {
          jsonResponse(res, 409, {
            ok: false,
            error: "A trace is already active",
          });
          return;
        }

        ensureTraceDirectory();
        const id = `${Date.now()}-${randomUUID()}`;
        const tracePath = path.join(TRACE_DIR, `${id}.ndjson`);
        const stream = fs.createWriteStream(tracePath, { flags: "a" });

        const summary: TraceSummary = {
          id,
          label: body.label,
          startedAt: new Date().toISOString(),
          stoppedAt: null,
          eventCount: 0,
          path: tracePath,
        };

        activeTrace = {
          summary,
          stream,
        };

        pushSystem("Trace started", {
          traceId: id,
          label: body.label,
        });

        jsonResponse(res, 200, {
          ok: true,
          trace: summary,
        });
        queueDebugDelta?.();
        queueCoreDelta?.();
        return;
      }

      if (req.method === "POST" && pathname === "/api/debug/trace/mark") {
        const body = parseBody(TraceMarkBodySchema, await readJsonBody(req));
        if (!activeTrace) {
          jsonResponse(res, 409, { ok: false, error: "No active trace" });
          return;
        }

        const marker = {
          type: "trace-marker",
          at: new Date().toISOString(),
          note: body.note,
        };

        activeTrace.stream.write(`${JSON.stringify(marker)}\n`);
        activeTrace.summary.eventCount += 1;

        jsonResponse(res, 200, { ok: true });
        queueDebugDelta?.();
        return;
      }

      if (req.method === "POST" && pathname === "/api/debug/trace/stop") {
        if (!activeTrace) {
          jsonResponse(res, 409, { ok: false, error: "No active trace" });
          return;
        }

        const trace = activeTrace;
        activeTrace = null;

        trace.summary.stoppedAt = new Date().toISOString();
        trace.stream.end();

        recentTraces.unshift(trace.summary);
        if (recentTraces.length > 20) {
          recentTraces.splice(20);
        }

        pushSystem("Trace stopped", { traceId: trace.summary.id });

        jsonResponse(res, 200, {
          ok: true,
          trace: trace.summary,
        });
        queueDebugDelta?.();
        queueCoreDelta?.();
        return;
      }

      if (
        req.method === "GET" &&
        segments[2] === "trace" &&
        segments[3] &&
        segments[4] === "download"
      ) {
        const traceId = decodeURIComponent(segments[3]);
        const trace = recentTraces.find((item) => item.id === traceId);

        if (!trace || !fs.existsSync(trace.path)) {
          jsonResponse(res, 404, { ok: false, error: "Trace not found" });
          return;
        }

        const data = fs.readFileSync(trace.path);
        res.writeHead(200, {
          "Content-Type": "application/x-ndjson",
          "Content-Length": data.length,
          "Content-Disposition": `attachment; filename="${trace.id}.ndjson"`,
          "Access-Control-Allow-Origin": "*",
        });
        res.end(data);
        return;
      }
    }

    if (req.method === "GET" && pathname === "/api/account/rate-limits") {
      const adapter = registry.resolveFirstWithCapability("canReadRateLimits");
      if (!adapter || !adapter.readRateLimits) {
        jsonResponse(res, 400, {
          ok: false,
          error: "No agent supports rate limit reading",
        });
        return;
      }

      try {
        const result = await readRateLimitsShared();
        jsonResponse(res, 200, { ok: true, ...result });
      } catch (error) {
        const message = toErrorMessage(error);
        logger.warn({ error: message }, "rate-limits-read-failed");
        jsonResponse(res, 500, { ok: false, error: message });
      }
      return;
    }

    jsonResponse(res, 404, { ok: false, error: "Not found" });
  } catch (error) {
    runtimeLastError = toErrorMessage(error);
    logger.error(
      {
        method: req.method ?? "unknown",
        url: req.url ?? "unknown",
        error: runtimeLastError,
      },
      "request-failed",
    );
    pushSystem("Request failed", {
      error: runtimeLastError,
      method: req.method ?? "unknown",
      url: req.url ?? "unknown",
    });
    queueCoreDelta?.();
    broadcastSyncError?.(runtimeLastError, "requestFailed");
    jsonResponse(res, 500, {
      ok: false,
      error: runtimeLastError,
    });
  }
});

const io = new SocketServer(server, {
  path: "/api/unified/ws",
  transports: ["websocket"],
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const realtimeCoordinator = new RealtimeCoordinator({
  io,
  buildCoreState: () => buildRealtimeCoreState(),
  buildThreadState: (input) => buildRealtimeThreadState(input),
  buildDebugState: () => buildRealtimeDebugState(),
});
realtimeCoordinator.start();

queueCoreDelta = () => {
  realtimeCoordinator.queueCoreDelta();
};
queueDebugDelta = () => {
  realtimeCoordinator.queueDebugDelta();
};
queueThreadDelta = (threadId: string) => {
  realtimeCoordinator.queueThreadDelta(threadId);
};
broadcastSyncError = (message: string, code?: string) => {
  realtimeCoordinator.broadcastSyncError(message, code);
};

server.on("connection", (socket) => {
  activeSockets.add(socket);
  socket.on("close", () => {
    activeSockets.delete(socket);
  });
});

async function start(): Promise<void> {
  ensureTraceDirectory();

  pushSystem("Starting Farfield monitor server", {
    appExecutable: codexExecutable,
    socketPath: ipcSocketPath,
    agentIds: configuredAgentIds,
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      reject(error);
    };

    server.once("error", onError);
    server.listen({ port: PORT, host: HOST, exclusive: true }, () => {
      server.off("error", onError);
      resolve();
    });
  });

  pushSystem("Monitor server ready", {
    url: `http://${HOST}:${PORT}`,
    appExecutable: codexExecutable,
    socketPath: ipcSocketPath,
    agentIds: configuredAgentIds,
  });

  for (const adapter of registry.listAdapters()) {
    try {
      await adapter.start();
      pushSystem("Agent connected", {
        agentId: adapter.id,
        connected: adapter.isConnected(),
      });

      if (adapter.id === "opencode" && openCodeAdapter) {
        pushSystem("OpenCode backend connected", {
          url: openCodeAdapter.getUrl(),
        });
      }
    } catch (error) {
      pushSystem("Agent failed to connect", {
        agentId: adapter.id,
        error: toErrorMessage(error),
      });
      logger.error(
        {
          agentId: adapter.id,
          error: toErrorMessage(error),
        },
        "agent-start-failed",
      );
    }
  }

  queueCoreDelta?.();
  queueDebugDelta?.();
  printStartupBanner();
  logger.info({ url: `http://${HOST}:${PORT}` }, "monitor-server-ready");
}

let shutdownPromise: Promise<void> | null = null;

async function shutdown(): Promise<void> {
  if (shutdownPromise) {
    return shutdownPromise;
  }

  shutdownPromise = (async () => {
    await new Promise<void>((resolve) => {
      io.close(() => {
        resolve();
      });
    });

    for (const socket of activeSockets) {
      socket.destroy();
    }
    activeSockets.clear();

    if (activeTrace) {
      activeTrace.stream.end();
      activeTrace = null;
    }

    await registry.stopAll();

    if (server.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  })();

  return shutdownPromise;
}

let shutdownRequested = false;
let forcedExitTimer: NodeJS.Timeout | null = null;

async function handleShutdownSignal(signal: "SIGINT" | "SIGTERM"): Promise<void> {
  if (shutdownRequested) {
    process.stderr.write(`\nReceived ${signal} again. Exiting now.\n`);
    process.exit(130);
    return;
  }

  shutdownRequested = true;
  process.stdout.write("\nStopping Farfield server...\n");

  forcedExitTimer = setTimeout(() => {
    process.stderr.write("Shutdown is taking too long. Exiting now.\n");
    process.exit(130);
  }, 4_000);
  forcedExitTimer.unref();

  try {
    await shutdown();
    if (forcedExitTimer) {
      clearTimeout(forcedExitTimer);
      forcedExitTimer = null;
    }
    process.exit(0);
  } catch (error) {
    if (forcedExitTimer) {
      clearTimeout(forcedExitTimer);
      forcedExitTimer = null;
    }
    process.stderr.write(`Shutdown failed: ${toErrorMessage(error)}\n`);
    process.exit(1);
  }
}

process.on("SIGINT", () => {
  void handleShutdownSignal("SIGINT");
});

process.on("SIGTERM", () => {
  void handleShutdownSignal("SIGTERM");
});

void start().catch((error) => {
  runtimeLastError = toErrorMessage(error);
  pushSystem("Monitor server failed to start", { error: runtimeLastError });
  logger.fatal({ error: runtimeLastError }, "monitor-server-failed-to-start");
  process.exit(1);
});

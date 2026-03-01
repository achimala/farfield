import http, { type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import type { IpcFrame } from "@farfield/protocol";
import {
  UnifiedCommandSchema,
  type UnifiedEvent,
  type UnifiedProviderId,
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
import { CodexAgentAdapter } from "./agents/adapters/codex-agent.js";
import { OpenCodeAgentAdapter } from "./agents/adapters/opencode-agent.js";
import type { AgentAdapter } from "./agents/types.js";
import {
  UnifiedBackendFeatureError,
  buildUnifiedFeatureMatrix,
  createUnifiedProviderAdapters,
} from "./unified/adapter.js";

const HOST = process.env["HOST"] ?? "127.0.0.1";
const PORT = Number(process.env["PORT"] ?? 4311);
const HISTORY_LIMIT = 2_000;
const USER_AGENT = "farfield/0.2.0";
const IPC_RECONNECT_DELAY_MS = 1_000;
const SIDEBAR_PREVIEW_MAX_CHARS = 180;

const TRACE_DIR = path.resolve(process.cwd(), "traces");
const DEFAULT_WORKSPACE = path.resolve(process.cwd());

interface HistoryEntry {
  id: string;
  at: string;
  source: "ipc" | "app" | "system";
  direction: "in" | "out" | "system";
  payload: unknown;
  meta: Record<string, unknown>;
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

function eventResponse(res: ServerResponse, body: unknown): void {
  res.write(`data: ${JSON.stringify(body)}\n\n`);
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
const unifiedSseClients = new Set<ServerResponse>();
const SSE_KEEPALIVE_INTERVAL_MS = 15_000;
const threadIndex = new ThreadIndex();

let activeTrace: ActiveTrace | null = null;
const recentTraces: TraceSummary[] = [];
let runtimeLastError: string | null = null;

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
  meta: Record<string, unknown> = {},
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
  return entry;
}

function pushSystem(
  message: string,
  details: Record<string, unknown> = {},
): void {
  logger.info({ message, ...details }, "system-event");
  pushHistory("system", "system", { message, details });
}

let codexAdapter: CodexAgentAdapter | null = null;
let openCodeAdapter: OpenCodeAgentAdapter | null = null;
const adapters: AgentAdapter[] = [];

for (const agentId of configuredAgentIds) {
  if (agentId === "codex") {
    codexAdapter = new CodexAgentAdapter({
      appExecutable: codexExecutable,
      socketPath: ipcSocketPath,
      workspaceDir: DEFAULT_WORKSPACE,
      userAgent: USER_AGENT,
      reconnectDelayMs: IPC_RECONNECT_DELAY_MS,
      onStateChange: () => {
        broadcastRuntimeState();
      },
    });

    codexAdapter.onIpcFrame((event) => {
      pushHistory("ipc", event.direction, event.frame, {
        method: event.method,
        threadId: event.threadId,
      });
    });

    adapters.push(codexAdapter);
    continue;
  }

  if (agentId === "opencode") {
    openCodeAdapter = new OpenCodeAgentAdapter();
    adapters.push(openCodeAdapter);
  }
}

const registry = new AgentRegistry(adapters);
const unifiedAdapters = createUnifiedProviderAdapters({
  codex: codexAdapter,
  opencode: openCodeAdapter,
});

function getRuntimeStateSnapshot(): Record<string, unknown> {
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
  };
}

function resolveUnifiedAdapter(provider: UnifiedProviderId) {
  return unifiedAdapters[provider];
}

function listUnifiedProviders(): UnifiedProviderId[] {
  return configuredUnifiedProviders;
}

function buildUnifiedProviderStateEvents(): UnifiedEvent[] {
  return listUnifiedProviders().map((provider) => {
    const adapter = resolveUnifiedAdapter(provider);
    const connected = adapter
      ? (registry.getAdapter(provider)?.isConnected() ?? false)
      : false;
    const enabled = adapter
      ? (registry.getAdapter(provider)?.isEnabled() ?? false)
      : false;

    return {
      kind: "providerStateChanged",
      provider,
      enabled,
      connected,
      lastError:
        provider === "codex"
          ? (runtimeLastError ??
            codexAdapter?.getRuntimeState().lastError ??
            null)
          : (runtimeLastError ?? null),
    };
  });
}

function broadcastUnifiedEvent(event: UnifiedEvent): void {
  for (const client of unifiedSseClients) {
    eventResponse(client, event);
  }
}

function writeSseKeepalive(): void {
  for (const client of unifiedSseClients) {
    try {
      client.write(": keepalive\n\n");
    } catch {
      unifiedSseClients.delete(client);
    }
  }
}

function broadcastRuntimeState(): void {
  for (const event of buildUnifiedProviderStateEvents()) {
    broadcastUnifiedEvent(event);
  }
}

setInterval(() => {
  writeSseKeepalive();
}, SSE_KEEPALIVE_INTERVAL_MS);

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

    if (req.method === "GET" && pathname === "/api/unified/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
        "Access-Control-Allow-Origin": "*",
      });
      res.write("retry: 1000\n\n");

      unifiedSseClients.add(res);
      for (const event of buildUnifiedProviderStateEvents()) {
        eventResponse(res, event);
      }

      req.on("close", () => {
        unifiedSseClients.delete(res);
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
          broadcastUnifiedEvent({
            kind: "threadUpdated",
            threadId: result.thread.id,
            provider: result.thread.provider,
            thread: result.thread,
          });
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
        broadcastUnifiedEvent({
          kind: "error",
          message,
          code: "internalError",
        });
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

      const data: Array<{
        id: string;
        provider: UnifiedProviderId;
        preview: string;
        title?: string | null | undefined;
        isGenerating?: boolean | undefined;
        createdAt: number;
        updatedAt: number;
        cwd?: string | undefined;
        source?: string | undefined;
      }> = [];
      const cursors: Record<UnifiedProviderId, string | null> = {
        codex: null,
        opencode: null,
      };
      const errors: Record<
        UnifiedProviderId,
        {
          code: string;
          message: string;
          details?: Record<string, string>;
        } | null
      > = {
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

          try {
            const result = await adapter.execute({
              kind: "listThreads",
              provider,
              limit,
              archived,
              all,
              maxPages,
              cursor,
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

      jsonResponse(res, 200, {
        ok: true,
        data,
        cursors,
        errors,
      });
      return;
    }

    if (req.method === "GET" && pathname === "/api/unified/sidebar") {
      const limit = parseInteger(url.searchParams.get("limit"), 80);
      const archived = parseBoolean(url.searchParams.get("archived"), false);
      const all = parseBoolean(url.searchParams.get("all"), false);
      const maxPages = parseInteger(url.searchParams.get("maxPages"), 20);
      const cursor = url.searchParams.get("cursor") ?? null;

      const rows: Array<{
        id: string;
        provider: UnifiedProviderId;
        preview: string;
        title?: string | null | undefined;
        isGenerating?: boolean | undefined;
        createdAt: number;
        updatedAt: number;
        cwd?: string | undefined;
        source?: string | undefined;
      }> = [];
      const errors: Record<
        UnifiedProviderId,
        {
          code: string;
          message: string;
          details?: Record<string, string>;
        } | null
      > = {
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

          try {
            const result = await adapter.execute({
              kind: "listThreads",
              provider,
              limit,
              archived,
              all,
              maxPages,
              cursor,
            });

            for (const thread of result.data) {
              threadIndex.register(thread.id, thread.provider);
              rows.push({
                ...thread,
                preview: compactSidebarPreview(thread.preview),
              });
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
              "unified-sidebar-threads-failed",
            );
          }
        }),
      );

      jsonResponse(res, 200, {
        ok: true,
        rows,
        errors,
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
      const provider = providerFromQuery ?? resolvedProvider;

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

      const adapter = resolveUnifiedAdapter(provider);
      if (!adapter) {
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
        const result = await adapter.execute({
          kind: "readThread",
          provider,
          threadId,
          includeTurns,
        });

        threadIndex.register(result.thread.id, result.thread.provider);
        jsonResponse(res, 200, {
          ok: true,
          thread: result.thread,
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
      if (req.method === "GET" && segments[2] === "history") {
        const limit = parseInteger(url.searchParams.get("limit"), 120);
        const data = history.slice(-limit);
        jsonResponse(res, 200, { ok: true, history: data });
        return;
      }

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
          entry,
          fullPayload: historyById.get(entryId) ?? null,
        });
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
        const result = await adapter.readRateLimits();
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
    broadcastRuntimeState();
    jsonResponse(res, 500, {
      ok: false,
      error: runtimeLastError,
    });
  }
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

  broadcastRuntimeState();
  logger.info({ url: `http://${HOST}:${PORT}` }, "monitor-server-ready");
}

async function shutdown(): Promise<void> {
  if (activeTrace) {
    activeTrace.stream.end();
    activeTrace = null;
  }

  await registry.stopAll();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

process.on("SIGINT", () => {
  void shutdown().then(() => process.exit(0));
});

process.on("SIGTERM", () => {
  void shutdown().then(() => process.exit(0));
});

void start().catch((error) => {
  runtimeLastError = toErrorMessage(error);
  pushSystem("Monitor server failed to start", { error: runtimeLastError });
  logger.fatal({ error: runtimeLastError }, "monitor-server-failed-to-start");
  process.exit(1);
});

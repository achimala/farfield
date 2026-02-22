import http, { type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { AppServerRpcError, type SendRequestOptions } from "@farfield/api";
import type { IpcFrame, IpcRequestFrame } from "@farfield/protocol";
import {
  InterruptBodySchema,
  parseBody,
  ReplayBodySchema,
  SendMessageBodySchema,
  StartThreadBodySchema,
  SetModeBodySchema,
  SubmitUserInputBodySchema,
  TraceMarkBodySchema,
  TraceStartBodySchema
} from "./http-schemas.js";
import { logger } from "./logger.js";
import {
  parseServerCliOptions,
  formatServerHelpText
} from "./agents/cli-options.js";
import { AgentRegistry } from "./agents/registry.js";
import { ThreadIndex } from "./agents/thread-index.js";
import { CodexAgentAdapter } from "./agents/adapters/codex-agent.js";
import { OpenCodeAgentAdapter } from "./agents/adapters/opencode-agent.js";
import type { AgentAdapter, AgentDescriptor, AgentId } from "./agents/types.js";
import { createSecurityPolicy } from "./auth.js";

const HOST = process.env["HOST"] ?? "127.0.0.1";
const PORT = Number(process.env["PORT"] ?? 4311);
const HISTORY_LIMIT = 2_000;
const USER_AGENT = "farfield/0.2.0";
const IPC_RECONNECT_DELAY_MS = 1_000;

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

interface ParsedReplayFrame {
  type: "request" | "broadcast";
  method: string;
  params: IpcRequestFrame["params"];
  targetClientId?: string;
  version?: number;
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
      encoding: "utf8"
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

function jsonResponse(res: ServerResponse, statusCode: number, body: unknown): void {
  const encoded = Buffer.from(JSON.stringify(body), "utf8");
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": encoded.length,
    "Access-Control-Allow-Origin": security.corsOrigin,
    "Access-Control-Allow-Headers": "content-type,cf-access-jwt-assertion",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
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

function ensureTraceDirectory(): void {
  if (!fs.existsSync(TRACE_DIR)) {
    fs.mkdirSync(TRACE_DIR, { recursive: true });
  }
}

function parseReplayFrame(payload: unknown): ParsedReplayFrame {
  if (!payload || typeof payload !== "object") {
    throw new Error("Entry payload is unavailable");
  }

  const record = payload as Record<string, unknown>;
  const type = record["type"];
  if (type !== "request" && type !== "broadcast") {
    throw new Error("Only captured request and broadcast entries can be replayed");
  }

  const method = record["method"];
  if (typeof method !== "string" || method.trim().length === 0) {
    throw new Error("Captured IPC frame has invalid method");
  }

  const targetClientId = record["targetClientId"];
  const version = record["version"];

  return {
    type,
    method,
    params: record["params"],
    ...(typeof targetClientId === "string" ? { targetClientId } : {}),
    ...(typeof version === "number" ? { version } : {})
  };
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
const codexExecutable = resolveCodexExecutablePath();
const ipcSocketPath = resolveIpcSocketPath();
const gitCommit = resolveGitCommitHash();

const history: HistoryEntry[] = [];
const historyById = new Map<string, unknown>();
const sseClients = new Set<ServerResponse>();
const SSE_KEEPALIVE_INTERVAL_MS = 15_000;
const threadIndex = new ThreadIndex();
const security = createSecurityPolicy();

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
  meta: Record<string, unknown> = {}
): HistoryEntry {
  const entry: HistoryEntry = {
    id: randomUUID(),
    at: new Date().toISOString(),
    source,
    direction,
    payload,
    meta
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
  broadcastSse({ type: "history", entry });
  return entry;
}

function summarizeActionDetails(details: Record<string, unknown>): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  const keys = ["agentId", "threadId", "ownerClientId", "requestId", "textLength", "cwd", "model"];

  for (const key of keys) {
    const value = details[key];
    if (value !== undefined) {
      summary[key] = value;
    }
  }

  return summary;
}

function pushActionEvent(
  action: string,
  stage: "attempt" | "success" | "error",
  details: Record<string, unknown>
): void {
  logger.info(
    {
      action,
      stage,
      ...summarizeActionDetails(details)
    },
    "action-event"
  );
  pushHistory("app", "out", {
    type: "action",
    action,
    stage,
    ...details
  }, details);
}

function pushActionError(
  action: string,
  error: unknown,
  details: Record<string, unknown>
): string {
  const message = toErrorMessage(error);
  logger.error(
    {
      action,
      error: message,
      ...summarizeActionDetails(details)
    },
    "action-error"
  );
  pushActionEvent(action, "error", { ...details, error: message });
  pushSystem("Action failed", { action, ...details, error: message });
  return message;
}

function pushSystem(message: string, details: Record<string, unknown> = {}): void {
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
      }
    });

    codexAdapter.onIpcFrame((event) => {
      pushHistory("ipc", event.direction, event.frame, {
        method: event.method,
        threadId: event.threadId
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

function buildAgentDescriptor(adapter: AgentAdapter, projectDirectories: string[]): AgentDescriptor {
  return {
    id: adapter.id,
    label: adapter.label,
    enabled: adapter.isEnabled(),
    connected: adapter.isConnected(),
    capabilities: adapter.capabilities,
    projectDirectories
  };
}

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
    activeTrace: activeTrace?.summary ?? null
  };
}

function broadcastSse(payload: unknown): void {
  for (const client of sseClients) {
    eventResponse(client, payload);
  }
}

function writeSseKeepalive(): void {
  for (const client of sseClients) {
    try {
      client.write(": keepalive\n\n");
    } catch {
      sseClients.delete(client);
    }
  }
}

function broadcastRuntimeState(): void {
  broadcastSse({
    type: "state",
    state: getRuntimeStateSnapshot()
  });
}

setInterval(() => {
  writeSseKeepalive();
}, SSE_KEEPALIVE_INTERVAL_MS);

function resolveCreateThreadAdapter(
  requestedAgentId: AgentId | undefined
): AgentAdapter | null {
  if (requestedAgentId) {
    const adapter = registry.getAdapter(requestedAgentId);
    if (!adapter) {
      return null;
    }
    if (!adapter.isEnabled()) {
      return null;
    }
    return adapter;
  }

  const defaultAgentId = registry.resolveDefaultAgentId();
  if (!defaultAgentId) {
    return null;
  }

  return registry.getAdapter(defaultAgentId);
}

function resolveAdapterForThread(threadId: string):
  | { ok: true; adapter: AgentAdapter; agentId: AgentId }
  | { ok: false; status: number; error: string } {
  const registeredAgentId = threadIndex.resolve(threadId);
  if (!registeredAgentId) {
    return {
      ok: false,
      status: 404,
      error: `Thread ${threadId} is not registered. Refresh thread list and try again.`
    };
  }

  const adapter = registry.getAdapter(registeredAgentId);
  if (!adapter || !adapter.isEnabled()) {
    return {
      ok: false,
      status: 503,
      error: `Agent ${registeredAgentId} is not enabled for thread ${threadId}.`
    };
  }

  if (!adapter.isConnected()) {
    return {
      ok: false,
      status: 503,
      error: `Agent ${registeredAgentId} is not connected for thread ${threadId}.`
    };
  }

  return {
    ok: true,
    adapter,
    agentId: registeredAgentId
  };
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
    const requiresApiAuth = pathname === "/events" || pathname.startsWith("/api/");

    if (requiresApiAuth) {
      const authResult = await security.authenticate(req);
      if (!authResult.ok) {
        jsonResponse(res, authResult.status, {
          ok: false,
          error: authResult.error
        });
        return;
      }
    }

    if (req.method === "GET" && pathname === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
        "Access-Control-Allow-Origin": security.corsOrigin
      });
      res.write("retry: 1000\n\n");

      sseClients.add(res);
      eventResponse(res, {
        type: "state",
        state: getRuntimeStateSnapshot()
      });

      req.on("close", () => {
        sseClients.delete(res);
      });
      return;
    }

    if (req.method === "GET" && pathname === "/api/health") {
      jsonResponse(res, 200, {
        ok: true,
        state: getRuntimeStateSnapshot()
      });
      return;
    }

    if (req.method === "GET" && pathname === "/api/agents") {
      const descriptors = await Promise.all(
        registry.listAdapters().map(async (adapter) => {
          if (!adapter.listProjectDirectories || !adapter.isConnected()) {
            return buildAgentDescriptor(adapter, []);
          }

          try {
            const projectDirectories = await adapter.listProjectDirectories();
            return buildAgentDescriptor(adapter, projectDirectories);
          } catch (error) {
            logger.warn(
              {
                agentId: adapter.id,
                error: toErrorMessage(error)
              },
              "agent-project-directory-list-failed"
            );
            return buildAgentDescriptor(adapter, []);
          }
        })
      );

      const defaultAgentId = registry.resolveDefaultAgentId() ?? configuredAgentIds[0];

      jsonResponse(res, 200, {
        ok: true,
        agents: descriptors,
        defaultAgentId
      });
      return;
    }

    if (req.method === "POST" && pathname === "/api/threads") {
      const body = parseBody(StartThreadBodySchema, await readJsonBody(req));
      const adapter = resolveCreateThreadAdapter(body.agentId);

      if (!adapter) {
        jsonResponse(res, 503, {
          ok: false,
          error: body.agentId
            ? `Requested agent ${body.agentId} is not enabled.`
            : "No enabled agent is available."
        });
        return;
      }

      pushActionEvent("thread-create", "attempt", {
        agentId: adapter.id,
        cwd: body.cwd ?? null,
        model: body.model ?? null
      });

      try {
        const createInput = {
          ...(body.cwd
            ? { cwd: body.cwd }
            : adapter.id === "codex"
              ? { cwd: DEFAULT_WORKSPACE }
              : {}),
          ...(body.model ? { model: body.model } : {}),
          ...(body.modelProvider ? { modelProvider: body.modelProvider } : {}),
          ...(body.personality ? { personality: body.personality } : {}),
          ...(body.sandbox ? { sandbox: body.sandbox } : {}),
          ...(body.approvalPolicy ? { approvalPolicy: body.approvalPolicy } : {}),
          ...(typeof body.ephemeral === "boolean" ? { ephemeral: body.ephemeral } : {})
        };
        const result = await adapter.createThread(createInput);

        threadIndex.register(result.threadId, adapter.id);

        pushActionEvent("thread-create", "success", {
          agentId: adapter.id,
          threadId: result.threadId,
          cwd: result.cwd ?? result.thread.cwd ?? null
        });

        jsonResponse(res, 200, {
          ok: true,
          ...result,
          threadId: result.threadId,
          agentId: adapter.id
        });
      } catch (error) {
        const message = pushActionError("thread-create", error, {
          agentId: adapter.id,
          cwd: body.cwd ?? null
        });
        jsonResponse(res, 500, { ok: false, error: message });
      }
      return;
    }

    if (req.method === "GET" && pathname === "/api/threads") {
      const limit = parseInteger(url.searchParams.get("limit"), 80);
      const archived = parseBoolean(url.searchParams.get("archived"), false);
      const all = parseBoolean(url.searchParams.get("all"), false);
      const maxPages = parseInteger(url.searchParams.get("maxPages"), 20);
      const cursor = url.searchParams.get("cursor") ?? null;

      const enabledAdapters = registry.listEnabled();
      const mergedData: Array<Record<string, unknown>> = [];
      let nextCursor: string | null = null;

      for (const adapter of enabledAdapters) {
        try {
          const result = await adapter.listThreads({
            limit,
            archived,
            all,
            maxPages,
            cursor
          });

          if (!nextCursor && result.nextCursor) {
            nextCursor = result.nextCursor;
          }

          for (const thread of result.data) {
            threadIndex.register(thread.id, adapter.id);
            mergedData.push({
              ...thread,
              agentId: adapter.id
            });
          }
        } catch (error) {
          logger.warn(
            {
              agentId: adapter.id,
              error: toErrorMessage(error)
            },
            "agent-list-threads-failed"
          );
        }
      }

      jsonResponse(res, 200, {
        ok: true,
        data: mergedData,
        nextCursor
      });
      return;
    }

    if (req.method === "GET" && pathname === "/api/models") {
      const adapter = registry.resolveFirstWithCapability("canListModels");
      if (!adapter || !adapter.listModels) {
        jsonResponse(res, 200, {
          ok: true,
          data: [],
          nextCursor: null
        });
        return;
      }

      const limit = parseInteger(url.searchParams.get("limit"), 100);
      const result = await adapter.listModels(limit);
      jsonResponse(res, 200, { ok: true, ...result });
      return;
    }

    if (req.method === "GET" && pathname === "/api/collaboration-modes") {
      const adapter = registry.resolveFirstWithCapability("canListCollaborationModes");
      if (!adapter || !adapter.listCollaborationModes) {
        jsonResponse(res, 200, {
          ok: true,
          data: []
        });
        return;
      }

      const result = await adapter.listCollaborationModes();
      jsonResponse(res, 200, { ok: true, ...result });
      return;
    }

    if (segments[0] === "api" && segments[1] === "threads" && segments[2]) {
      const threadId = decodeURIComponent(segments[2]);
      const resolved = resolveAdapterForThread(threadId);
      if (!resolved.ok) {
        jsonResponse(res, resolved.status, {
          ok: false,
          error: resolved.error,
          threadId
        });
        return;
      }

      const adapter = resolved.adapter;

      if (req.method === "GET" && segments.length === 3) {
        const includeTurns = parseBoolean(url.searchParams.get("includeTurns"), true);

        try {
          const result = await adapter.readThread({ threadId, includeTurns });
          jsonResponse(res, 200, {
            ok: true,
            ...result,
            agentId: resolved.agentId
          });
          return;
        } catch (error) {
          if (
            resolved.agentId === "codex" &&
            codexAdapter &&
            error instanceof Error &&
            codexAdapter.isThreadNotLoadedError(error)
          ) {
            jsonResponse(res, 404, {
              ok: false,
              error: `Thread not loaded in app-server: ${threadId}`,
              threadId
            });
            return;
          }
          throw error;
        }
      }

      if (req.method === "GET" && segments[3] === "live-state") {
        if (!adapter.capabilities.canReadLiveState || !adapter.readLiveState) {
          jsonResponse(res, 400, {
            ok: false,
            error: `Agent ${resolved.agentId} does not support live thread state`,
            threadId
          });
          return;
        }

        const liveState = await adapter.readLiveState(threadId);
        jsonResponse(res, 200, {
          ok: true,
          threadId,
          ownerClientId: liveState.ownerClientId,
          conversationState: liveState.conversationState,
          liveStateError: liveState.liveStateError
        });
        return;
      }

      if (req.method === "GET" && segments[3] === "stream-events") {
        if (!adapter.capabilities.canReadStreamEvents || !adapter.readStreamEvents) {
          jsonResponse(res, 400, {
            ok: false,
            error: `Agent ${resolved.agentId} does not support stream events`,
            threadId
          });
          return;
        }

        const limit = parseInteger(url.searchParams.get("limit"), 60);
        const streamEvents = await adapter.readStreamEvents(threadId, limit);
        jsonResponse(res, 200, {
          ok: true,
          threadId,
          ownerClientId: streamEvents.ownerClientId,
          events: streamEvents.events
        });
        return;
      }

      if (req.method === "POST" && segments[3] === "messages") {
        const body = parseBody(SendMessageBodySchema, await readJsonBody(req));

        pushActionEvent("messages", "attempt", {
          agentId: resolved.agentId,
          threadId,
          textLength: body.text.length
        });

        try {
          await adapter.sendMessage({
            threadId,
            text: body.text,
            ...(body.ownerClientId ? { ownerClientId: body.ownerClientId } : {}),
            ...(body.cwd ? { cwd: body.cwd } : {}),
            ...(typeof body.isSteering === "boolean" ? { isSteering: body.isSteering } : {})
          });
        } catch (error) {
          const message = pushActionError("messages", error, {
            agentId: resolved.agentId,
            threadId
          });
          jsonResponse(res, 500, { ok: false, error: message, threadId });
          return;
        }

        pushActionEvent("messages", "success", {
          agentId: resolved.agentId,
          threadId
        });

        jsonResponse(res, 200, {
          ok: true,
          threadId
        });
        return;
      }

      if (req.method === "POST" && segments[3] === "collaboration-mode") {
        if (!adapter.capabilities.canSetCollaborationMode || !adapter.setCollaborationMode) {
          jsonResponse(res, 400, {
            ok: false,
            error: `Agent ${resolved.agentId} does not support collaboration modes`,
            threadId
          });
          return;
        }

        const body = parseBody(SetModeBodySchema, await readJsonBody(req));

        pushActionEvent("collaboration-mode", "attempt", {
          agentId: resolved.agentId,
          threadId,
          collaborationMode: body.collaborationMode
        });

        try {
          const result = await adapter.setCollaborationMode({
            threadId,
            ...(body.ownerClientId ? { ownerClientId: body.ownerClientId } : {}),
            collaborationMode: body.collaborationMode
          });

          pushActionEvent("collaboration-mode", "success", {
            agentId: resolved.agentId,
            threadId,
            ownerClientId: result.ownerClientId
          });

          jsonResponse(res, 200, {
            ok: true,
            threadId,
            ownerClientId: result.ownerClientId
          });
        } catch (error) {
          const message = pushActionError("collaboration-mode", error, {
            agentId: resolved.agentId,
            threadId
          });
          jsonResponse(res, 500, {
            ok: false,
            error: message,
            threadId
          });
        }
        return;
      }

      if (req.method === "POST" && segments[3] === "user-input") {
        if (!adapter.capabilities.canSubmitUserInput || !adapter.submitUserInput) {
          jsonResponse(res, 400, {
            ok: false,
            error: `Agent ${resolved.agentId} does not support user input submission`,
            threadId
          });
          return;
        }

        const body = parseBody(SubmitUserInputBodySchema, await readJsonBody(req));

        pushActionEvent("user-input", "attempt", {
          agentId: resolved.agentId,
          threadId,
          requestId: body.requestId
        });

        try {
          const result = await adapter.submitUserInput({
            threadId,
            ...(body.ownerClientId ? { ownerClientId: body.ownerClientId } : {}),
            requestId: body.requestId,
            response: body.response
          });

          pushActionEvent("user-input", "success", {
            agentId: resolved.agentId,
            threadId,
            ownerClientId: result.ownerClientId,
            requestId: result.requestId
          });

          jsonResponse(res, 200, {
            ok: true,
            threadId,
            ownerClientId: result.ownerClientId,
            requestId: result.requestId
          });
        } catch (error) {
          const message = pushActionError("user-input", error, {
            agentId: resolved.agentId,
            threadId,
            requestId: body.requestId
          });
          jsonResponse(res, 500, {
            ok: false,
            error: message,
            threadId,
            requestId: body.requestId
          });
        }
        return;
      }

      if (req.method === "POST" && segments[3] === "interrupt") {
        const body = parseBody(InterruptBodySchema, await readJsonBody(req));

        pushActionEvent("interrupt", "attempt", {
          agentId: resolved.agentId,
          threadId
        });

        try {
          await adapter.interrupt({
            threadId,
            ...(body.ownerClientId ? { ownerClientId: body.ownerClientId } : {})
          });
        } catch (error) {
          const message = pushActionError("interrupt", error, {
            agentId: resolved.agentId,
            threadId
          });
          jsonResponse(res, 500, { ok: false, error: message, threadId });
          return;
        }

        pushActionEvent("interrupt", "success", {
          agentId: resolved.agentId,
          threadId
        });

        jsonResponse(res, 200, {
          ok: true,
          threadId
        });
        return;
      }
    }

    if (segments[0] === "api" && segments[1] === "debug") {
      if (!security.debugApiEnabled) {
        jsonResponse(res, 404, { ok: false, error: "Not found" });
        return;
      }

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
          jsonResponse(res, 404, { ok: false, error: "History entry not found" });
          return;
        }

        jsonResponse(res, 200, {
          ok: true,
          entry,
          fullPayload: historyById.get(entryId) ?? null
        });
        return;
      }

      if (req.method === "POST" && pathname === "/api/debug/replay") {
        if (!codexAdapter) {
          jsonResponse(res, 503, {
            ok: false,
            error: "Codex adapter is not enabled"
          });
          return;
        }

        if (!codexAdapter.isIpcReady()) {
          jsonResponse(res, 503, {
            ok: false,
            error: codexAdapter.getRuntimeState().lastError ?? "Desktop IPC is not connected"
          });
          return;
        }

        const body = parseBody(ReplayBodySchema, await readJsonBody(req));
        const entry = history.find((item) => item.id === body.entryId);
        if (!entry) {
          jsonResponse(res, 404, { ok: false, error: "History entry not found" });
          return;
        }

        let frame: ParsedReplayFrame;
        try {
          frame = parseReplayFrame(historyById.get(entry.id));
        } catch (error) {
          jsonResponse(res, 409, {
            ok: false,
            error: toErrorMessage(error)
          });
          return;
        }

        const options: SendRequestOptions = {
          ...(frame.targetClientId ? { targetClientId: frame.targetClientId } : {}),
          ...(typeof frame.version === "number" ? { version: frame.version } : {})
        };

        if (frame.type === "request") {
          const replayPromise = codexAdapter.replayRequest(frame.method, frame.params, options);

          if (body.waitForResponse) {
            const response = await replayPromise;
            jsonResponse(res, 200, {
              ok: true,
              replayed: true,
              response
            });
            return;
          }

          void replayPromise.catch((error) => {
            pushSystem("Replay request failed", {
              error: toErrorMessage(error),
              entryId: entry.id
            });
          });

          jsonResponse(res, 200, {
            ok: true,
            replayed: true,
            queued: true
          });
          return;
        }

        codexAdapter.replayBroadcast(frame.method, frame.params, options);
        jsonResponse(res, 200, { ok: true, replayed: true });
        return;
      }

      if (req.method === "GET" && pathname === "/api/debug/trace/status") {
        jsonResponse(res, 200, {
          ok: true,
          active: activeTrace?.summary ?? null,
          recent: recentTraces
        });
        return;
      }

      if (req.method === "POST" && pathname === "/api/debug/trace/start") {
        const body = parseBody(TraceStartBodySchema, await readJsonBody(req));
        if (activeTrace) {
          jsonResponse(res, 409, {
            ok: false,
            error: "A trace is already active"
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
          path: tracePath
        };

        activeTrace = {
          summary,
          stream
        };

        pushSystem("Trace started", {
          traceId: id,
          label: body.label
        });

        jsonResponse(res, 200, {
          ok: true,
          trace: summary
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
          note: body.note
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
          trace: trace.summary
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
          "Access-Control-Allow-Origin": security.corsOrigin
        });
        res.end(data);
        return;
      }
    }

    jsonResponse(res, 404, { ok: false, error: "Not found" });
  } catch (error) {
    runtimeLastError = toErrorMessage(error);
    logger.error(
      {
        method: req.method ?? "unknown",
        url: req.url ?? "unknown",
        error: runtimeLastError
      },
      "request-failed"
    );
    pushSystem("Request failed", {
      error: runtimeLastError,
      method: req.method ?? "unknown",
      url: req.url ?? "unknown"
    });
    broadcastRuntimeState();
    jsonResponse(res, 500, {
      ok: false,
      error: runtimeLastError
    });
  }
});

async function start(): Promise<void> {
  ensureTraceDirectory();

  pushSystem("Starting Farfield monitor server", {
    appExecutable: codexExecutable,
    socketPath: ipcSocketPath,
    agentIds: configuredAgentIds,
    authMode: security.authMode,
    debugApiEnabled: security.debugApiEnabled,
    cloudflareTeamDomain: security.cloudflareTeamDomain
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      reject(error);
    };

    server.once("error", onError);
    server.listen(PORT, HOST, () => {
      server.off("error", onError);
      resolve();
    });
  });

  pushSystem("Monitor server ready", {
    url: `http://${HOST}:${PORT}`,
    appExecutable: codexExecutable,
    socketPath: ipcSocketPath,
    agentIds: configuredAgentIds,
    authMode: security.authMode,
    debugApiEnabled: security.debugApiEnabled,
    cloudflareTeamDomain: security.cloudflareTeamDomain
  });

  for (const adapter of registry.listAdapters()) {
    try {
      await adapter.start();
      pushSystem("Agent connected", {
        agentId: adapter.id,
        connected: adapter.isConnected()
      });

      if (adapter.id === "opencode" && openCodeAdapter) {
        pushSystem("OpenCode backend connected", {
          url: openCodeAdapter.getUrl()
        });
      }
    } catch (error) {
      pushSystem("Agent failed to connect", {
        agentId: adapter.id,
        error: toErrorMessage(error)
      });
      logger.error(
        {
          agentId: adapter.id,
          error: toErrorMessage(error)
        },
        "agent-start-failed"
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

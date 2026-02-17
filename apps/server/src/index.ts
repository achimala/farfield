import http, { type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { randomUUID } from "node:crypto";
import {
  AppServerClient,
  CodexMonitorService,
  DesktopIpcClient,
  reduceThreadStreamEvents,
  type SendRequestOptions
} from "@codex-monitor/codex-api";
import {
  type CollaborationMode,
  type IpcFrame,
  type ThreadStreamStateChangedBroadcast,
  parseThreadStreamStateChangedBroadcast,
  parseUserInputResponsePayload
} from "@codex-monitor/codex-protocol";
import {
  InterruptBodySchema,
  parseBody,
  ReplayBodySchema,
  SendMessageBodySchema,
  SetModeBodySchema,
  SubmitUserInputBodySchema,
  TraceMarkBodySchema,
  TraceStartBodySchema
} from "./http-schemas.js";
import { resolveOwnerClientId } from "./thread-owner.js";

const HOST = process.env["HOST"] ?? "127.0.0.1";
const PORT = Number(process.env["PORT"] ?? 4311);
const HISTORY_LIMIT = 2_000;
const USER_AGENT = "codex-monitor-web/0.2.0";

const TRACE_DIR = path.resolve(process.cwd(), "traces");
const DEFAULT_WORKSPACE = path.resolve(process.cwd());

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

function jsonResponse(res: ServerResponse, statusCode: number, body: unknown): void {
  const encoded = Buffer.from(JSON.stringify(body), "utf8");
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": encoded.length,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type",
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

const history: HistoryEntry[] = [];
const historyById = new Map<string, unknown>();

const threadOwnerById = new Map<string, string>();
const streamEventsByThreadId = new Map<string, ThreadStreamStateChangedBroadcast[]>();

const sseClients = new Set<ServerResponse>();

let activeTrace: ActiveTrace | null = null;
const recentTraces: TraceSummary[] = [];

const runtimeState = {
  appExecutable: resolveCodexExecutablePath(),
  socketPath: resolveIpcSocketPath(),
  appReady: false,
  ipcConnected: false,
  ipcInitialized: false,
  lastError: null as string | null
};

let bootstrapInFlight: Promise<void> | null = null;

function getRuntimeStateSnapshot(): Record<string, unknown> {
  return {
    ...runtimeState,
    historyCount: history.length,
    threadOwnerCount: threadOwnerById.size,
    activeTrace: activeTrace?.summary ?? null
  };
}

function ensureTraceDirectory(): void {
  if (!fs.existsSync(TRACE_DIR)) {
    fs.mkdirSync(TRACE_DIR, { recursive: true });
  }
}

function recordTraceEvent(event: unknown): void {
  if (!activeTrace) {
    return;
  }

  activeTrace.summary.eventCount += 1;
  activeTrace.stream.write(`${JSON.stringify(event)}\n`);
}

function broadcastSse(payload: unknown): void {
  for (const client of sseClients) {
    eventResponse(client, payload);
  }
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

function pushSystem(message: string, details: Record<string, unknown> = {}): void {
  pushHistory("system", "system", { message, details });
}

function broadcastRuntimeState(): void {
  broadcastSse({
    type: "state",
    state: getRuntimeStateSnapshot()
  });
}

function setRuntimeError(error: unknown): string {
  const message = toErrorMessage(error);
  runtimeState.lastError = message;
  return message;
}

function requireIpcReady(res: ServerResponse): boolean {
  if (runtimeState.ipcConnected && runtimeState.ipcInitialized) {
    return true;
  }

  jsonResponse(res, 503, {
    ok: false,
    error: runtimeState.lastError ?? "Desktop IPC is not connected"
  });
  return false;
}

const appClient = new AppServerClient({
  executablePath: runtimeState.appExecutable,
  userAgent: USER_AGENT,
  cwd: DEFAULT_WORKSPACE
});

const ipcClient = new DesktopIpcClient({
  socketPath: runtimeState.socketPath
});

const service = new CodexMonitorService(appClient, ipcClient);

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

function getThreadLiveState(threadId: string): {
  ownerClientId: string | null;
  conversationState: unknown;
} {
  const events = streamEventsByThreadId.get(threadId) ?? [];
  if (events.length === 0) {
    return {
      ownerClientId: threadOwnerById.get(threadId) ?? null,
      conversationState: null
    };
  }

  const reduced = reduceThreadStreamEvents(events);
  const state = reduced.get(threadId);

  return {
    ownerClientId: state?.ownerClientId ?? null,
    conversationState: state?.conversationState ?? null
  };
}

function extractThreadId(frame: IpcFrame): string | null {
  if (frame.type === "broadcast" && frame.method === "thread-stream-state-changed") {
    const parsed = parseThreadStreamStateChangedBroadcast(frame);
    return parsed.params.conversationId;
  }

  if (frame.type !== "request") {
    return null;
  }

  const params = frame.params;
  if (!params || typeof params !== "object") {
    return null;
  }

  const asRecord = params as Record<string, unknown>;
  const candidates = [
    asRecord["conversationId"],
    asRecord["threadId"],
    asRecord["turnId"]
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return null;
}

async function sendIpcRequest(
  method: string,
  params: unknown,
  options: SendRequestOptions = {}
): Promise<unknown> {
  const payload = {
    type: "request",
    method,
    params,
    targetClientId: options.targetClientId ?? null,
    version: options.version ?? null
  };

  pushHistory("ipc", "out", payload, {
    method,
    threadId: extractThreadId({
      type: "request",
      requestId: 0,
      method,
      params,
      targetClientId: options.targetClientId,
      version: options.version
    })
  });

  const response = await ipcClient.sendRequestAndWait(method, params, options);
  return response;
}

function sendIpcBroadcast(method: string, params: unknown, options: SendRequestOptions = {}): void {
  const payload = {
    type: "broadcast",
    method,
    params,
    targetClientId: options.targetClientId ?? null,
    version: options.version ?? null
  };

  pushHistory("ipc", "out", payload, {
    method,
    threadId: extractThreadId({
      type: "request",
      requestId: 0,
      method,
      params,
      targetClientId: options.targetClientId,
      version: options.version
    })
  });

  ipcClient.sendBroadcast(method, params, options);
}

ipcClient.onConnectionState((state) => {
  runtimeState.ipcConnected = state.connected;
  if (!state.connected) {
    runtimeState.ipcInitialized = false;
    runtimeState.appReady = false;
  }

  if (state.reason) {
    runtimeState.lastError = state.reason;
    pushSystem("IPC connection state changed", {
      connected: state.connected,
      reason: state.reason
    });
  }

  broadcastRuntimeState();
});

ipcClient.onFrame((frame) => {
  const threadId = extractThreadId(frame);

  pushHistory("ipc", "in", frame, {
    method: frame.type === "request" || frame.type === "broadcast" ? frame.method : "response",
    threadId
  });

  if (frame.type === "broadcast" && frame.method === "thread-stream-state-changed") {
    const parsed = parseThreadStreamStateChangedBroadcast(frame);
    threadOwnerById.set(parsed.params.conversationId, parsed.sourceClientId);

    const current = streamEventsByThreadId.get(parsed.params.conversationId) ?? [];
    current.push(parsed);
    if (current.length > 400) {
      current.splice(0, current.length - 400);
    }
    streamEventsByThreadId.set(parsed.params.conversationId, current);
  }
});

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

    if (req.method === "GET" && pathname === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*"
      });

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

    if (req.method === "GET" && pathname === "/api/threads") {
      const limit = parseInteger(url.searchParams.get("limit"), 80);
      const archived = parseBoolean(url.searchParams.get("archived"), false);
      const all = parseBoolean(url.searchParams.get("all"), false);
      const maxPages = parseInteger(url.searchParams.get("maxPages"), 20);
      const cursor = url.searchParams.get("cursor") ?? null;

      const result = all
        ? await appClient.listThreadsAll(
            cursor
              ? {
                  limit,
                  archived,
                  cursor,
                  maxPages
                }
              : {
                  limit,
                  archived,
                  maxPages
                }
          )
        : await appClient.listThreads(
            cursor
              ? {
                  limit,
                  archived,
                  cursor
                }
              : {
                  limit,
                  archived
                }
          );

      jsonResponse(res, 200, { ok: true, ...result });
      return;
    }

    if (req.method === "GET" && pathname === "/api/models") {
      const limit = parseInteger(url.searchParams.get("limit"), 100);
      const result = await appClient.listModels(limit);
      jsonResponse(res, 200, { ok: true, ...result });
      return;
    }

    if (req.method === "GET" && pathname === "/api/collaboration-modes") {
      const result = await appClient.listCollaborationModes();
      jsonResponse(res, 200, { ok: true, ...result });
      return;
    }

    if (segments[0] === "api" && segments[1] === "threads" && segments[2]) {
      const threadId = decodeURIComponent(segments[2]);

      if (req.method === "GET" && segments.length === 3) {
        const includeTurns = parseBoolean(url.searchParams.get("includeTurns"), true);
        const result = await appClient.readThread(threadId, includeTurns);
        jsonResponse(res, 200, { ok: true, ...result });
        return;
      }

      if (req.method === "GET" && segments[3] === "live-state") {
        const live = getThreadLiveState(threadId);
        jsonResponse(res, 200, {
          ok: true,
          threadId,
          ownerClientId: live.ownerClientId,
          conversationState: live.conversationState
        });
        return;
      }

      if (req.method === "GET" && segments[3] === "stream-events") {
        const limit = parseInteger(url.searchParams.get("limit"), 60);
        const events = (streamEventsByThreadId.get(threadId) ?? []).slice(-limit);
        jsonResponse(res, 200, {
          ok: true,
          threadId,
          ownerClientId: threadOwnerById.get(threadId) ?? null,
          events
        });
        return;
      }

      if (req.method === "POST" && segments[3] === "messages") {
        if (!requireIpcReady(res)) {
          return;
        }

        const body = parseBody(SendMessageBodySchema, await readJsonBody(req));
        const ownerClientId = resolveOwnerClientId(threadOwnerById, threadId, body.ownerClientId);

        const messageInput = {
          threadId,
          ownerClientId,
          text: body.text
        } as const;

        await service.sendMessage({
          ...messageInput,
          ...(body.cwd ? { cwd: body.cwd } : {}),
          ...(typeof body.isSteering === "boolean" ? { isSteering: body.isSteering } : {})
        });

        pushHistory("app", "out", {
          type: "action",
          action: "messages",
          threadId,
          ownerClientId
        });

        jsonResponse(res, 200, {
          ok: true,
          threadId,
          ownerClientId
        });
        return;
      }

      if (req.method === "POST" && segments[3] === "collaboration-mode") {
        if (!requireIpcReady(res)) {
          return;
        }

        const body = parseBody(SetModeBodySchema, await readJsonBody(req));
        const ownerClientId = resolveOwnerClientId(threadOwnerById, threadId, body.ownerClientId);

        await service.setCollaborationMode({
          threadId,
          ownerClientId,
          collaborationMode: body.collaborationMode as CollaborationMode
        });

        pushHistory("app", "out", {
          type: "action",
          action: "collaboration-mode",
          threadId,
          ownerClientId,
          collaborationMode: body.collaborationMode
        });

        jsonResponse(res, 200, {
          ok: true,
          threadId,
          ownerClientId
        });
        return;
      }

      if (req.method === "POST" && segments[3] === "user-input") {
        if (!requireIpcReady(res)) {
          return;
        }

        const body = parseBody(SubmitUserInputBodySchema, await readJsonBody(req));
        const ownerClientId = resolveOwnerClientId(threadOwnerById, threadId, body.ownerClientId);

        await service.submitUserInput({
          threadId,
          ownerClientId,
          requestId: body.requestId,
          response: parseUserInputResponsePayload(body.response)
        });

        pushHistory("app", "out", {
          type: "action",
          action: "user-input",
          threadId,
          ownerClientId,
          requestId: body.requestId
        });

        jsonResponse(res, 200, {
          ok: true,
          threadId,
          ownerClientId,
          requestId: body.requestId
        });
        return;
      }

      if (req.method === "POST" && segments[3] === "interrupt") {
        if (!requireIpcReady(res)) {
          return;
        }

        const body = parseBody(InterruptBodySchema, await readJsonBody(req));
        const ownerClientId = resolveOwnerClientId(threadOwnerById, threadId, body.ownerClientId);

        await service.interrupt({
          threadId,
          ownerClientId
        });

        pushHistory("app", "out", {
          type: "action",
          action: "interrupt",
          threadId,
          ownerClientId
        });

        jsonResponse(res, 200, {
          ok: true,
          threadId,
          ownerClientId
        });
        return;
      }
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
        if (!requireIpcReady(res)) {
          return;
        }

        const body = parseBody(ReplayBodySchema, await readJsonBody(req));
        const entry = history.find((item) => item.id === body.entryId);
        if (!entry) {
          jsonResponse(res, 404, { ok: false, error: "History entry not found" });
          return;
        }

        const payload = historyById.get(entry.id);
        if (!payload || typeof payload !== "object") {
          jsonResponse(res, 409, { ok: false, error: "Entry payload is unavailable" });
          return;
        }

        const record = payload as Record<string, unknown>;
        const type = record["type"];

        if (type === "request") {
          const method = record["method"];
          if (typeof method !== "string") {
            jsonResponse(res, 409, { ok: false, error: "Captured request has invalid method" });
            return;
          }

          const options: SendRequestOptions = {};
          if (typeof record["targetClientId"] === "string") {
            options.targetClientId = record["targetClientId"];
          }
          if (typeof record["version"] === "number") {
            options.version = record["version"];
          }

          const sendPromise = sendIpcRequest(method, record["params"], options);

          if (body.waitForResponse) {
            const response = await sendPromise;
            jsonResponse(res, 200, { ok: true, replayed: true, response });
            return;
          }

          void sendPromise.catch((error) => {
            pushSystem("Replay request failed", { error: toErrorMessage(error), entryId: entry.id });
          });

          jsonResponse(res, 200, {
            ok: true,
            replayed: true,
            queued: true
          });
          return;
        }

        if (type === "broadcast") {
          const method = record["method"];
          if (typeof method !== "string") {
            jsonResponse(res, 409, { ok: false, error: "Captured broadcast has invalid method" });
            return;
          }

          const options: SendRequestOptions = {};
          if (typeof record["targetClientId"] === "string") {
            options.targetClientId = record["targetClientId"];
          }
          if (typeof record["version"] === "number") {
            options.version = record["version"];
          }

          sendIpcBroadcast(method, record["params"], options);

          jsonResponse(res, 200, { ok: true, replayed: true });
          return;
        }

        jsonResponse(res, 409, {
          ok: false,
          error: "Only captured request and broadcast entries can be replayed"
        });
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
          "Access-Control-Allow-Origin": "*"
        });
        res.end(data);
        return;
      }
    }

    jsonResponse(res, 404, { ok: false, error: "Not found" });
  } catch (error) {
    runtimeState.lastError = toErrorMessage(error);
    pushSystem("Request failed", {
      error: runtimeState.lastError,
      method: req.method ?? "unknown",
      url: req.url ?? "unknown"
    });
    broadcastRuntimeState();
    jsonResponse(res, 500, {
      ok: false,
      error: runtimeState.lastError
    });
  }
});

async function bootstrapConnections(): Promise<void> {
  if (bootstrapInFlight) {
    return bootstrapInFlight;
  }

  bootstrapInFlight = (async () => {
    try {
      if (!ipcClient.isConnected()) {
        await ipcClient.connect();
      }
      runtimeState.ipcConnected = true;

      const initializeResponse = await ipcClient.initialize(USER_AGENT);
      runtimeState.ipcInitialized = true;

      const initializeResult = initializeResponse.result;
      if (initializeResult && typeof initializeResult === "object") {
        const candidate = (initializeResult as Record<string, unknown>)["clientId"];
        if (typeof candidate === "string" && candidate.trim()) {
          pushSystem("IPC initialized", { clientId: candidate });
        }
      }

      await appClient.listThreads({ limit: 1, archived: false });
      runtimeState.appReady = true;
      runtimeState.lastError = null;
    } catch (error) {
      runtimeState.appReady = false;
      runtimeState.ipcInitialized = false;
      if (!ipcClient.isConnected()) {
        runtimeState.ipcConnected = false;
      }

      const errorMessage = setRuntimeError(error);
      pushSystem("Codex bootstrap failed", { error: errorMessage });
    } finally {
      broadcastRuntimeState();
      bootstrapInFlight = null;
    }
  })();

  return bootstrapInFlight;
}

async function start(): Promise<void> {
  ensureTraceDirectory();

  pushSystem("Starting Codex monitor server", {
    appExecutable: runtimeState.appExecutable,
    socketPath: runtimeState.socketPath
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
    appExecutable: runtimeState.appExecutable,
    socketPath: runtimeState.socketPath
  });
  broadcastRuntimeState();

  // eslint-disable-next-line no-console
  console.log(`Codex monitor server running at http://${HOST}:${PORT}`);

  void bootstrapConnections();
}

async function shutdown(): Promise<void> {
  if (activeTrace) {
    activeTrace.stream.end();
    activeTrace = null;
  }

  await ipcClient.disconnect();
  await appClient.close();

  await new Promise<void>((resolve) => server.close(() => resolve()));
}

process.on("SIGINT", () => {
  void shutdown().then(() => process.exit(0));
});

process.on("SIGTERM", () => {
  void shutdown().then(() => process.exit(0));
});

void start().catch((error) => {
  const errorMessage = setRuntimeError(error);
  pushSystem("Monitor server failed to start", { error: errorMessage });
  // eslint-disable-next-line no-console
  console.error(`Failed to start monitor server: ${errorMessage}`);
  process.exit(1);
});

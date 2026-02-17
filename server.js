const http = require("node:http");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const net = require("node:net");
const { spawn } = require("node:child_process");
const readline = require("node:readline");
const { randomUUID } = require("node:crypto");

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 4311);
const STATIC_DIR = path.join(__dirname, "public");
const DEFAULT_WORKSPACE = process.env.DEFAULT_WORKSPACE || path.resolve(__dirname, "..");
const MAX_HISTORY = 600;
const SSE_HISTORY_LIMIT = 220;
const MAX_FRAME_SIZE = 256 * 1024 * 1024;
const MAX_BODY_BYTES = 1024 * 1024;
const IPC_RECONNECT_MS = 1000;
const APP_RESTART_MS = 1500;
const APP_REQUEST_TIMEOUT_MS = 45000;

const METHOD_VERSION = {
  "thread-stream-state-changed": 4,
  "thread-archived": 1,
  "thread-follower-start-turn": 1,
  "thread-follower-interrupt-turn": 1,
  "thread-follower-set-model-and-reasoning": 1,
  "thread-follower-set-collaboration-mode": 1,
  "thread-follower-command-approval-decision": 1,
  "thread-follower-file-approval-decision": 1,
  "thread-follower-submit-user-input": 1,
  "thread-follower-set-queued-follow-ups-state": 1,
  "thread-queued-followups-changed": 1
};

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

const state = {
  ipc: {
    socketPath: null,
    transportConnected: false,
    initialized: false,
    clientId: null,
    lastError: null
  },
  app: {
    executablePath: null,
    running: false,
    initialized: false,
    pid: null,
    userAgent: null,
    lastError: null
  }
};

const history = [];
const sseClients = new Set();

function nowIso() {
  return new Date().toISOString();
}

function toErrorMessage(error) {
  if (!error) {
    return "Unknown error";
  }
  if (typeof error === "string") {
    return error;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function sendSse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function broadcastSse(payload) {
  for (const res of sseClients) {
    sendSse(res, payload);
  }
}

function updateNestedState(section, patch) {
  Object.assign(state[section], patch);
  broadcastSse({ type: "state", state });
}

function extractThreadIdFromNotification(message) {
  if (!message || typeof message !== "object") {
    return null;
  }

  const params = message.params;
  if (!params || typeof params !== "object") {
    return null;
  }

  return (
    params.threadId ||
    params.conversationId ||
    params.thread?.id ||
    params.msg?.thread_id ||
    params.msg?.threadId ||
    params.msg?.conversationId ||
    null
  );
}

function pushHistory(source, direction, payload, meta = {}) {
  const entry = {
    id: randomUUID(),
    at: nowIso(),
    source,
    direction,
    payload,
    meta
  };

  history.push(entry);
  if (history.length > MAX_HISTORY) {
    history.shift();
  }

  broadcastSse({ type: "message", entry });
}

function pushSystem(source, message, details) {
  const payload = details ? { message, details } : { message };
  pushHistory(source, "system", payload);
}

function versionForMethod(method) {
  return METHOD_VERSION[method] ?? 0;
}

function resolveIpcSocketPath() {
  if (process.env.CODEX_IPC_SOCKET) {
    return process.env.CODEX_IPC_SOCKET;
  }

  if (process.platform === "win32") {
    return "\\\\.\\pipe\\codex-ipc";
  }

  const tempDir = path.join(os.tmpdir(), "codex-ipc");
  const uid = process.getuid ? process.getuid() : null;
  const fileName = uid != null ? `ipc-${uid}.sock` : "ipc.sock";
  return path.join(tempDir, fileName);
}

function resolveCodexExecutablePath() {
  if (process.env.CODEX_CLI_PATH) {
    return process.env.CODEX_CLI_PATH;
  }

  const desktopPath = "/Applications/Codex.app/Contents/Resources/codex";
  if (fs.existsSync(desktopPath)) {
    return desktopPath;
  }

  return "codex";
}

class CodexIpcClient {
  constructor() {
    this.socketPath = resolveIpcSocketPath();
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.reconnectTimer = null;
    this.connecting = false;
    this.clientId = null;
    updateNestedState("ipc", { socketPath: this.socketPath });
  }

  connect() {
    if (this.connecting || this.socket) {
      return;
    }

    this.connecting = true;
    pushSystem("ipc", "Connecting to desktop socket", { socketPath: this.socketPath });

    const socket = net.createConnection(this.socketPath);
    this.socket = socket;

    socket.on("connect", () => {
      this.connecting = false;
      this.buffer = Buffer.alloc(0);
      updateNestedState("ipc", {
        transportConnected: true,
        initialized: false,
        clientId: null,
        lastError: null
      });
      pushSystem("ipc", "Connected to desktop socket");
      this.sendInitialize();
    });

    socket.on("data", (chunk) => {
      this.handleData(chunk);
    });

    socket.on("error", (error) => {
      updateNestedState("ipc", { lastError: toErrorMessage(error) });
      pushSystem("ipc", "Desktop socket error", { error: toErrorMessage(error) });
    });

    socket.on("close", () => {
      this.connecting = false;
      this.socket = null;
      this.buffer = Buffer.alloc(0);
      this.clientId = null;
      updateNestedState("ipc", {
        transportConnected: false,
        initialized: false,
        clientId: null
      });
      pushSystem("ipc", "Desktop socket closed");
      this.scheduleReconnect();
    });
  }

  reconnectNow() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }

    this.connecting = false;
    this.connect();
  }

  scheduleReconnect() {
    if (this.reconnectTimer) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, IPC_RECONNECT_MS);
  }

  sendInitialize() {
    const initializeMessage = {
      type: "request",
      requestId: randomUUID(),
      sourceClientId: "initializing-client",
      version: 1,
      method: "initialize",
      params: {
        clientType: "codex-monitor-web"
      }
    };

    this.sendFrame(initializeMessage);
  }

  sendRequest(method, params, targetClientId, versionOverride) {
    if (!this.socket || this.socket.destroyed) {
      throw new Error("Desktop socket is not connected.");
    }

    const version =
      Number.isInteger(versionOverride) && versionOverride >= 0
        ? versionOverride
        : versionForMethod(method);

    const requestMessage = {
      type: "request",
      requestId: randomUUID(),
      sourceClientId: this.clientId || "initializing-client",
      version,
      method,
      params
    };

    if (targetClientId && targetClientId.trim()) {
      requestMessage.targetClientId = targetClientId.trim();
    }

    this.sendFrame(requestMessage);
    return requestMessage.requestId;
  }

  sendBroadcast(method, params, versionOverride) {
    if (!this.socket || this.socket.destroyed) {
      throw new Error("Desktop socket is not connected.");
    }

    const version =
      Number.isInteger(versionOverride) && versionOverride >= 0
        ? versionOverride
        : versionForMethod(method);

    const broadcastMessage = {
      type: "broadcast",
      sourceClientId: this.clientId || "initializing-client",
      version,
      method,
      params
    };

    this.sendFrame(broadcastMessage);
  }

  sendFrame(message) {
    if (!this.socket || this.socket.destroyed) {
      throw new Error("Desktop socket is not connected.");
    }

    const body = Buffer.from(JSON.stringify(message), "utf8");
    const header = Buffer.alloc(4);
    header.writeUInt32LE(body.length, 0);
    this.socket.write(Buffer.concat([header, body]));
    pushHistory("ipc", "out", message);
  }

  handleData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (this.buffer.length >= 4) {
      const frameLength = this.buffer.readUInt32LE(0);
      if (frameLength > MAX_FRAME_SIZE) {
        pushSystem("ipc", "Desktop frame too large, closing", { frameLength });
        this.socket?.destroy();
        return;
      }

      if (this.buffer.length < frameLength + 4) {
        return;
      }

      const frameBody = this.buffer.subarray(4, frameLength + 4);
      this.buffer = this.buffer.subarray(frameLength + 4);

      let parsed;
      try {
        parsed = JSON.parse(frameBody.toString("utf8"));
      } catch (error) {
        pushSystem("ipc", "Failed to parse desktop frame", {
          error: toErrorMessage(error)
        });
        continue;
      }

      this.handleIncomingMessage(parsed);
    }
  }

  handleIncomingMessage(message) {
    pushHistory("ipc", "in", message);

    if (
      message &&
      message.type === "response" &&
      message.method === "initialize" &&
      message.resultType === "success" &&
      message.result &&
      typeof message.result.clientId === "string"
    ) {
      this.clientId = message.result.clientId;
      updateNestedState("ipc", {
        initialized: true,
        clientId: this.clientId,
        lastError: null
      });
      pushSystem("ipc", "Monitor client initialized", { clientId: this.clientId });
    }
  }
}

class AppServerClient {
  constructor() {
    this.executablePath = resolveCodexExecutablePath();
    this.proc = null;
    this.stdoutInterface = null;
    this.pendingRequests = new Map();
    this.activeTurnsByThread = new Map();
    this.nextId = 1;
    this.restartingTimer = null;
    this.starting = false;
    this.readyWaiters = new Set();

    updateNestedState("app", { executablePath: this.executablePath });
  }

  start() {
    if (this.starting || this.proc) {
      return;
    }

    this.starting = true;
    pushSystem("app", "Starting app-server process", {
      executablePath: this.executablePath
    });

    const proc = spawn(this.executablePath, ["app-server"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env
    });

    this.proc = proc;

    proc.once("spawn", () => {
      this.starting = false;
      updateNestedState("app", {
        running: true,
        initialized: false,
        pid: proc.pid,
        userAgent: null,
        lastError: null
      });
      pushSystem("app", "app-server process started", { pid: proc.pid });
      this.initializeHandshake();
    });

    proc.on("error", (error) => {
      this.starting = false;
      updateNestedState("app", { lastError: toErrorMessage(error) });
      pushSystem("app", "app-server process error", { error: toErrorMessage(error) });
    });

    proc.on("close", (code, signal) => {
      this.handleProcessClosed(code, signal);
    });

    if (proc.stdout) {
      this.stdoutInterface = readline.createInterface({
        input: proc.stdout,
        crlfDelay: Infinity
      });
      this.stdoutInterface.on("line", (line) => {
        this.handleStdoutLine(line);
      });
    }

    if (proc.stderr) {
      const stderrReader = readline.createInterface({
        input: proc.stderr,
        crlfDelay: Infinity
      });
      stderrReader.on("line", (line) => {
        if (!line.trim()) {
          return;
        }
        pushHistory("app", "stderr", { line });
      });
    }
  }

  restartNow() {
    if (this.restartingTimer) {
      clearTimeout(this.restartingTimer);
      this.restartingTimer = null;
    }

    this.stopProcess("manual restart");
    this.start();
  }

  stopProcess(reason) {
    if (!this.proc) {
      return;
    }

    pushSystem("app", "Stopping app-server process", { reason });

    const proc = this.proc;
    this.proc = null;

    try {
      proc.kill();
    } catch (error) {
      pushSystem("app", "Failed to kill app-server process", {
        error: toErrorMessage(error)
      });
    }
  }

  handleProcessClosed(code, signal) {
    if (this.stdoutInterface) {
      this.stdoutInterface.close();
      this.stdoutInterface = null;
    }

    this.starting = false;
    this.proc = null;
    this.activeTurnsByThread.clear();

    for (const { reject, timer } of this.pendingRequests.values()) {
      clearTimeout(timer);
      reject(new Error("app-server closed"));
    }
    this.pendingRequests.clear();

    updateNestedState("app", {
      running: false,
      initialized: false,
      pid: null,
      userAgent: null
    });

    pushSystem("app", "app-server process closed", { code, signal });
    this.rejectReadyWaiters(new Error("app-server closed"));
    this.scheduleRestart();
  }

  scheduleRestart() {
    if (this.restartingTimer) {
      return;
    }

    this.restartingTimer = setTimeout(() => {
      this.restartingTimer = null;
      this.start();
    }, APP_RESTART_MS);
  }

  async waitUntilReady(timeoutMs = 15000) {
    if (state.app.initialized) {
      return;
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.readyWaiters.delete(waiter);
        reject(new Error("Timed out waiting for app-server initialization"));
      }, timeoutMs);

      const waiter = {
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        }
      };

      this.readyWaiters.add(waiter);
      this.start();
    });
  }

  resolveReadyWaiters() {
    for (const waiter of this.readyWaiters) {
      waiter.resolve();
    }
    this.readyWaiters.clear();
  }

  rejectReadyWaiters(error) {
    for (const waiter of this.readyWaiters) {
      waiter.reject(error);
    }
    this.readyWaiters.clear();
  }

  async initializeHandshake() {
    try {
      const result = await this.request(
        "initialize",
        {
          clientInfo: {
            name: "codex-monitor-web",
            version: "0.2.0"
          },
          capabilities: {
            experimentalApi: true
          }
        },
        {
          allowBeforeReady: true,
          timeoutMs: 20000
        }
      );

      updateNestedState("app", {
        initialized: true,
        userAgent: result?.userAgent || null,
        lastError: null
      });

      pushSystem("app", "app-server initialized", {
        userAgent: result?.userAgent || null
      });
      this.resolveReadyWaiters();
    } catch (error) {
      updateNestedState("app", {
        initialized: false,
        lastError: toErrorMessage(error)
      });
      pushSystem("app", "app-server initialize failed", {
        error: toErrorMessage(error)
      });
      this.rejectReadyWaiters(new Error(toErrorMessage(error)));
    }
  }

  handleStdoutLine(line) {
    if (!line.trim()) {
      return;
    }

    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      pushSystem("app", "Failed to parse app-server line", {
        line,
        error: toErrorMessage(error)
      });
      return;
    }

    const isNotification =
      message &&
      typeof message === "object" &&
      typeof message.method === "string" &&
      message.id === undefined;

    const threadId = isNotification ? extractThreadIdFromNotification(message) : null;
    const meta = isNotification ? { method: message.method, threadId } : {};

    pushHistory(
      "app",
      isNotification ? "in-notification" : "in-response",
      message,
      meta
    );

    if (isNotification) {
      if (message.method === "turn/started") {
        const threadIdFromEvent = message.params?.threadId;
        const turnIdFromEvent = message.params?.turn?.id;
        if (threadIdFromEvent && turnIdFromEvent) {
          this.activeTurnsByThread.set(threadIdFromEvent, turnIdFromEvent);
        }
      } else if (message.method === "turn/completed") {
        const threadIdFromEvent = message.params?.threadId;
        if (threadIdFromEvent) {
          this.activeTurnsByThread.delete(threadIdFromEvent);
        }
      }

      broadcastSse({
        type: "appNotification",
        method: message.method,
        threadId
      });
    }

    if (message && message.id !== undefined) {
      const pending = this.pendingRequests.get(message.id);
      if (!pending) {
        return;
      }

      clearTimeout(pending.timer);
      this.pendingRequests.delete(message.id);

      if (message.error) {
        const errMessage =
          message.error.message || message.error.error || JSON.stringify(message.error);
        pending.reject(new Error(errMessage));
        return;
      }

      if (pending.method === "turn/start") {
        const startedThreadId = pending.requestPayload?.params?.threadId;
        const startedTurnId = message.result?.turn?.id;
        if (startedThreadId && startedTurnId) {
          this.activeTurnsByThread.set(startedThreadId, startedTurnId);
        }
      } else if (pending.method === "turn/interrupt") {
        const interruptedThreadId = pending.requestPayload?.params?.threadId;
        if (interruptedThreadId) {
          this.activeTurnsByThread.delete(interruptedThreadId);
        }
      }

      pending.resolve(message.result);
    }
  }

  sendLine(message) {
    if (!this.proc || !this.proc.stdin || this.proc.stdin.destroyed) {
      throw new Error("app-server process is not writable");
    }
    this.proc.stdin.write(`${JSON.stringify(message)}\n`);
  }

  async request(method, params = {}, options = {}) {
    const {
      allowBeforeReady = false,
      timeoutMs = APP_REQUEST_TIMEOUT_MS
    } = options;

    if (!allowBeforeReady) {
      await this.waitUntilReady();
    } else {
      this.start();
    }

    if (!this.proc || !this.proc.stdin || this.proc.stdin.destroyed) {
      throw new Error("app-server is not running");
    }

    const id = this.nextId++;
    const requestPayload = {
      id,
      method,
      params
    };

    pushHistory("app", "out-request", requestPayload, { method });

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timed out: ${method}`));
      }, timeoutMs);

      this.pendingRequests.set(id, {
        resolve,
        reject,
        timer,
        method,
        requestPayload
      });

      try {
        this.sendLine(requestPayload);
      } catch (error) {
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        reject(error);
      }
    });
  }

  async listThreads(limit = 50, archived = false) {
    const params = { limit, archived };
    return this.request("thread/list", params);
  }

  async readThread(threadId, includeTurns = true) {
    return this.request("thread/read", {
      threadId,
      includeTurns
    });
  }

  async startThread(threadParams = {}) {
    return this.request("thread/start", threadParams);
  }

  async startTurn(threadId, text, options = {}) {
    const params = {
      threadId,
      input: [{ type: "text", text }],
      ...options
    };
    try {
      return await this.request("turn/start", params);
    } catch (error) {
      const message = toErrorMessage(error);
      if (!message.toLowerCase().includes("thread not found")) {
        throw error;
      }

      await this.request("thread/resume", { threadId });
      return this.request("turn/start", params);
    }
  }

  async listModels(limit = 100) {
    return this.request("model/list", { limit });
  }

  async findActiveTurn(threadId) {
    const trackedTurnId = this.activeTurnsByThread.get(threadId);
    if (trackedTurnId) {
      return { id: trackedTurnId, status: "inProgress" };
    }

    const response = await this.readThread(threadId, true);
    const turns = Array.isArray(response.thread?.turns) ? response.thread.turns : [];
    for (let i = turns.length - 1; i >= 0; i -= 1) {
      if (turns[i].status === "inProgress") {
        return turns[i];
      }
    }
    return null;
  }

  async interruptTurn(threadId, turnId = null) {
    let finalTurnId = turnId;
    if (!finalTurnId) {
      const activeTurn = await this.findActiveTurn(threadId);
      if (!activeTurn) {
        throw new Error("No active turn found for this thread.");
      }
      finalTurnId = activeTurn.id;
    }

    try {
      const result = await this.request("turn/interrupt", {
        threadId,
        turnId: finalTurnId
      });
      return {
        ...result,
        turnId: finalTurnId
      };
    } catch (error) {
      const message = toErrorMessage(error);
      if (!message.toLowerCase().includes("thread not found")) {
        throw error;
      }

      await this.request("thread/resume", { threadId });
      const result = await this.request("turn/interrupt", {
        threadId,
        turnId: finalTurnId
      });
      return {
        ...result,
        turnId: finalTurnId
      };
    }
  }
}

const ipcClient = new CodexIpcClient();
const appClient = new AppServerClient();
ipcClient.connect();
appClient.start();

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function badRequest(res, message) {
  sendJson(res, 400, { ok: false, error: message });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
        reject(new Error("Body too large"));
        req.destroy();
      }
    });

    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });

    req.on("error", (error) => {
      reject(error);
    });
  });
}

function parseBooleanQuery(value, fallback) {
  if (value === undefined || value === null || value === "") {
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

function parseOptionalInteger(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }
  return parsed;
}

async function serveStatic(res, pathname) {
  const requestPath = pathname === "/" ? "/index.html" : pathname;
  const safePath = path.normalize(decodeURIComponent(requestPath));
  const absolutePath = path.join(STATIC_DIR, safePath);

  if (!absolutePath.startsWith(STATIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  let fileBuffer;
  try {
    fileBuffer = await fsPromises.readFile(absolutePath);
  } catch {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const ext = path.extname(absolutePath).toLowerCase();
  const contentType = CONTENT_TYPES[ext] || "application/octet-stream";
  res.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": fileBuffer.length
  });
  res.end(fileBuffer);
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const { pathname, searchParams } = requestUrl;
  const segments = pathname.split("/").filter(Boolean);

  if (req.method === "GET" && pathname === "/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    res.write("\n");

    sseClients.add(res);
    sendSse(res, { type: "state", state });
    sendSse(res, {
      type: "history",
      messages: history.slice(-SSE_HISTORY_LIMIT)
    });

    req.on("close", () => {
      sseClients.delete(res);
    });
    return;
  }

  if (req.method === "GET" && pathname === "/api/state") {
    sendJson(res, 200, { ok: true, state, historySize: history.length });
    return;
  }

  if (req.method === "POST" && pathname === "/api/reconnect") {
    ipcClient.reconnectNow();
    appClient.restartNow();
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && pathname === "/api/reconnect-ipc") {
    ipcClient.reconnectNow();
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && pathname === "/api/app/restart") {
    appClient.restartNow();
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && pathname === "/api/threads") {
    try {
      const limit = parseOptionalInteger(searchParams.get("limit"), 50);
      const archived = parseBooleanQuery(searchParams.get("archived"), false);
      const result = await appClient.listThreads(limit, archived);
      sendJson(res, 200, { ok: true, ...result });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: toErrorMessage(error) });
    }
    return;
  }

  if (req.method === "GET" && pathname === "/api/models") {
    try {
      const limit = parseOptionalInteger(searchParams.get("limit"), 100);
      const result = await appClient.listModels(limit);
      sendJson(res, 200, { ok: true, ...result });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: toErrorMessage(error) });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/thread/start") {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      badRequest(res, toErrorMessage(error));
      return;
    }

    const params = {};
    params.cwd = typeof body.cwd === "string" && body.cwd.trim() ? body.cwd.trim() : DEFAULT_WORKSPACE;
    if (typeof body.model === "string" && body.model.trim()) {
      params.model = body.model.trim();
    }
    if (typeof body.modelProvider === "string" && body.modelProvider.trim()) {
      params.modelProvider = body.modelProvider.trim();
    }
    if (typeof body.personality === "string" && body.personality.trim()) {
      params.personality = body.personality.trim();
    }
    if (typeof body.sandbox === "string" && body.sandbox.trim()) {
      params.sandbox = body.sandbox.trim();
    }
    if (typeof body.approvalPolicy === "string" && body.approvalPolicy.trim()) {
      params.approvalPolicy = body.approvalPolicy.trim();
    }
    if (typeof body.ephemeral === "boolean") {
      params.ephemeral = body.ephemeral;
    }

    try {
      const result = await appClient.startThread(params);
      sendJson(res, 200, { ok: true, ...result });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: toErrorMessage(error) });
    }
    return;
  }

  if (
    segments[0] === "api" &&
    segments[1] === "thread" &&
    segments.length >= 3
  ) {
    const threadId = decodeURIComponent(segments[2]);

    if (req.method === "GET" && segments.length === 3) {
      const includeTurns = parseBooleanQuery(searchParams.get("includeTurns"), true);
      try {
        const result = await appClient.readThread(threadId, includeTurns);
        sendJson(res, 200, { ok: true, ...result });
      } catch (error) {
        sendJson(res, 500, { ok: false, error: toErrorMessage(error) });
      }
      return;
    }

    if (req.method === "POST" && segments[3] === "message") {
      let body;
      try {
        body = await readJsonBody(req);
      } catch (error) {
        badRequest(res, toErrorMessage(error));
        return;
      }

      const text = typeof body.text === "string" ? body.text.trim() : "";
      if (!text) {
        badRequest(res, "text is required");
        return;
      }

      const options = {};
      if (typeof body.model === "string" && body.model.trim()) {
        options.model = body.model.trim();
      }
      if (typeof body.cwd === "string" && body.cwd.trim()) {
        options.cwd = body.cwd.trim();
      }
      if (typeof body.effort === "string" && body.effort.trim()) {
        options.effort = body.effort.trim();
      }
      if (typeof body.personality === "string" && body.personality.trim()) {
        options.personality = body.personality.trim();
      }
      if (typeof body.summary === "string" && body.summary.trim()) {
        options.summary = body.summary.trim();
      }

      try {
        const result = await appClient.startTurn(threadId, text, options);
        sendJson(res, 200, { ok: true, ...result });
      } catch (error) {
        sendJson(res, 500, { ok: false, error: toErrorMessage(error) });
      }
      return;
    }

    if (req.method === "POST" && segments[3] === "interrupt") {
      let body;
      try {
        body = await readJsonBody(req);
      } catch (error) {
        badRequest(res, toErrorMessage(error));
        return;
      }

      const turnId =
        typeof body.turnId === "string" && body.turnId.trim()
          ? body.turnId.trim()
          : null;

      try {
        const result = await appClient.interruptTurn(threadId, turnId);
        sendJson(res, 200, { ok: true, ...result });
      } catch (error) {
        sendJson(res, 500, { ok: false, error: toErrorMessage(error) });
      }
      return;
    }
  }

  if (req.method === "POST" && pathname === "/api/send-request") {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      badRequest(res, toErrorMessage(error));
      return;
    }

    const method = typeof body.method === "string" ? body.method.trim() : "";
    if (!method) {
      badRequest(res, "method is required");
      return;
    }

    const params =
      body.params && typeof body.params === "object" ? body.params : {};
    const targetClientId =
      typeof body.targetClientId === "string" ? body.targetClientId : "";
    const version =
      Number.isInteger(body.version) && body.version >= 0 ? body.version : null;

    try {
      const requestId = ipcClient.sendRequest(method, params, targetClientId, version);
      sendJson(res, 200, { ok: true, requestId });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: toErrorMessage(error) });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/send-broadcast") {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      badRequest(res, toErrorMessage(error));
      return;
    }

    const method = typeof body.method === "string" ? body.method.trim() : "";
    if (!method) {
      badRequest(res, "method is required");
      return;
    }

    const params =
      body.params && typeof body.params === "object" ? body.params : {};
    const version =
      Number.isInteger(body.version) && body.version >= 0 ? body.version : null;

    try {
      ipcClient.sendBroadcast(method, params, version);
      sendJson(res, 200, { ok: true });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: toErrorMessage(error) });
    }
    return;
  }

  if (req.method === "GET") {
    await serveStatic(res, pathname);
    return;
  }

  res.writeHead(405);
  res.end("Method not allowed");
});

server.listen(PORT, HOST, () => {
  const url = `http://${HOST}:${PORT}`;
  const socketExists = fs.existsSync(state.ipc.socketPath || "");
  console.log(`Codex monitor running at ${url}`);
  console.log(`Desktop socket path: ${state.ipc.socketPath}`);
  console.log(`Desktop socket exists: ${socketExists ? "yes" : "no"}`);
  console.log(`App-server executable: ${state.app.executablePath}`);
});

const http = require("node:http");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const net = require("node:net");
const { randomUUID } = require("node:crypto");

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 4311);
const STATIC_DIR = path.join(__dirname, "public");
const MAX_HISTORY = 1000;
const MAX_FRAME_SIZE = 256 * 1024 * 1024;
const RECONNECT_MS = 1000;
const MAX_BODY_BYTES = 1024 * 1024;

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
  socketPath: null,
  transportConnected: false,
  initialized: false,
  clientId: null,
  lastError: null
};

const history = [];
const sseClients = new Set();

function versionForMethod(method) {
  return METHOD_VERSION[method] ?? 0;
}

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

function updateState(patch) {
  Object.assign(state, patch);
  broadcastSse({ type: "state", state });
}

function pushHistory(direction, payload) {
  const entry = {
    id: randomUUID(),
    at: nowIso(),
    direction,
    payload
  };

  history.push(entry);
  if (history.length > MAX_HISTORY) {
    history.shift();
  }

  broadcastSse({ type: "message", entry });
}

function pushSystem(message, details) {
  const payload = details ? { message, details } : { message };
  pushHistory("system", payload);
}

function resolveSocketPath() {
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

class CodexIpcClient {
  constructor() {
    this.socketPath = resolveSocketPath();
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.reconnectTimer = null;
    this.connecting = false;
    this.clientId = null;
    updateState({ socketPath: this.socketPath });
  }

  connect() {
    if (this.connecting || this.socket) {
      return;
    }

    this.connecting = true;
    pushSystem("Connecting to Codex socket", { socketPath: this.socketPath });

    const socket = net.createConnection(this.socketPath);
    this.socket = socket;

    socket.on("connect", () => {
      this.connecting = false;
      this.buffer = Buffer.alloc(0);
      updateState({
        transportConnected: true,
        initialized: false,
        clientId: null,
        lastError: null
      });
      pushSystem("Connected to Codex socket");
      this.sendInitialize();
    });

    socket.on("data", (chunk) => {
      this.handleData(chunk);
    });

    socket.on("error", (error) => {
      updateState({ lastError: toErrorMessage(error) });
      pushSystem("Socket error", { error: toErrorMessage(error) });
    });

    socket.on("close", () => {
      this.connecting = false;
      this.socket = null;
      this.buffer = Buffer.alloc(0);
      this.clientId = null;
      updateState({
        transportConnected: false,
        initialized: false,
        clientId: null
      });
      pushSystem("Codex socket closed");
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
    }, RECONNECT_MS);
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
      throw new Error("Not connected to the Codex socket.");
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
      throw new Error("Not connected to the Codex socket.");
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
      throw new Error("Not connected to the Codex socket.");
    }

    const body = Buffer.from(JSON.stringify(message), "utf8");
    const header = Buffer.alloc(4);
    header.writeUInt32LE(body.length, 0);

    this.socket.write(Buffer.concat([header, body]));
    pushHistory("out", message);
  }

  handleData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (this.buffer.length >= 4) {
      const frameLength = this.buffer.readUInt32LE(0);
      if (frameLength > MAX_FRAME_SIZE) {
        pushSystem("Frame too large, closing socket", { frameLength });
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
        pushSystem("Failed to parse incoming frame", {
          error: toErrorMessage(error)
        });
        continue;
      }

      this.handleIncomingMessage(parsed);
    }
  }

  handleIncomingMessage(message) {
    pushHistory("in", message);

    if (
      message &&
      message.type === "response" &&
      message.method === "initialize" &&
      message.resultType === "success" &&
      message.result &&
      typeof message.result.clientId === "string"
    ) {
      this.clientId = message.result.clientId;
      updateState({
        initialized: true,
        clientId: this.clientId,
        lastError: null
      });
      pushSystem("Monitor client initialized", { clientId: this.clientId });
    }
  }
}

const codexClient = new CodexIpcClient();
codexClient.connect();

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

async function serveStatic(req, res, pathname) {
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
  const { pathname } = requestUrl;

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
    sendSse(res, { type: "history", messages: history });

    req.on("close", () => {
      sseClients.delete(res);
    });

    return;
  }

  if (req.method === "GET" && pathname === "/api/state") {
    sendJson(res, 200, {
      ok: true,
      state,
      historySize: history.length
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/reconnect") {
    codexClient.reconnectNow();
    sendJson(res, 200, { ok: true });
    return;
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
      const requestId = codexClient.sendRequest(
        method,
        params,
        targetClientId,
        version
      );
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
      codexClient.sendBroadcast(method, params, version);
      sendJson(res, 200, { ok: true });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: toErrorMessage(error) });
    }
    return;
  }

  if (req.method === "GET") {
    await serveStatic(req, res, pathname);
    return;
  }

  res.writeHead(405);
  res.end("Method not allowed");
});

server.listen(PORT, HOST, () => {
  const url = `http://${HOST}:${PORT}`;
  const socketExists = fs.existsSync(state.socketPath || "");
  console.log(`Codex monitor running at ${url}`);
  console.log(`Socket path: ${state.socketPath}`);
  console.log(`Socket exists: ${socketExists ? "yes" : "no"}`);
});

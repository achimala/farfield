import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import readline from "node:readline";
import {
  type AppServerClientRequestMethod,
  type AppServerServerNotification,
  AppServerServerNotificationSchema,
  type AppServerServerRequest,
  AppServerServerRequestSchema
} from "@farfield/protocol";
import { z } from "zod";
import { AppServerRpcError, AppServerTransportError } from "./errors.js";
import {
  JsonRpcErrorSchema,
  JsonRpcNotificationSchema,
  JsonRpcRequestSchema,
  JsonRpcResponseSchema,
  type JsonRpcRequest,
  type JsonRpcResponse,
  parseJsonRpcIncomingMessage
} from "./json-rpc.js";

export type AppServerRequestId = JsonRpcRequest["id"];
export type AppServerNotificationListener = (
  notification: AppServerServerNotification
) => void;
export type AppServerRequestListener = (request: AppServerServerRequest) => void;

export interface AppServerTransport {
  request(
    method: AppServerClientRequestMethod,
    params: JsonRpcRequest["params"],
    timeoutMs?: number
  ): Promise<JsonRpcResponse["result"]>;
  respond(
    requestId: AppServerRequestId,
    result: JsonRpcResponse["result"]
  ): Promise<void>;
  onServerNotification(listener: AppServerNotificationListener): () => void;
  onServerRequest(listener: AppServerRequestListener): () => void;
  close(): Promise<void>;
}

interface PendingRequest {
  timer: NodeJS.Timeout;
  resolve: (value: JsonRpcResponse["result"]) => void;
  reject: (error: Error) => void;
}

export interface ChildProcessAppServerTransportOptions {
  executablePath: string;
  userAgent: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  requestTimeoutMs?: number;
  onStderr?: (line: string) => void;
  experimentalApi?: boolean;
  optOutNotificationMethods?: string[];
}

function toErrorMessage(error: Error | string): string {
  if (error instanceof Error) {
    return error.message;
  }
  return error;
}

function escapeJsonControlCharacter(char: string): string {
  switch (char) {
    case "\b":
      return "\\b";
    case "\f":
      return "\\f";
    case "\n":
      return "\\n";
    case "\r":
      return "\\r";
    case "\t":
      return "\\t";
  }

  const code = char.charCodeAt(0);
  if (code <= 0x1f) {
    return `\\u${code.toString(16).padStart(4, "0")}`;
  }
  return char;
}

export class ChildProcessAppServerTransport implements AppServerTransport {
  private readonly executablePath: string;
  private readonly userAgent: string;
  private readonly cwd: string | undefined;
  private readonly env: NodeJS.ProcessEnv | undefined;
  private readonly requestTimeoutMs: number;
  private readonly onStderr: ((line: string) => void) | undefined;
  private readonly experimentalApi: boolean;
  private readonly optOutNotificationMethods: readonly string[];

  private process: ChildProcessWithoutNullStreams | null = null;
  private readonly pending = new Map<AppServerRequestId, PendingRequest>();
  private readonly serverNotificationListeners =
    new Set<AppServerNotificationListener>();
  private readonly serverRequestListeners = new Set<AppServerRequestListener>();
  private requestId = 0;
  private initialized = false;
  private initializeInFlight: Promise<void> | null = null;
  private stdoutFrameBuffer = "";
  private stdoutFrameDepth = 0;
  private stdoutFrameInString = false;
  private stdoutFrameEscaped = false;

  public constructor(options: ChildProcessAppServerTransportOptions) {
    this.executablePath = options.executablePath;
    this.userAgent = options.userAgent;
    this.cwd = options.cwd;
    this.env = options.env;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.onStderr = options.onStderr;
    this.experimentalApi = options.experimentalApi ?? false;
    this.optOutNotificationMethods = options.optOutNotificationMethods ?? [];
  }

  public onServerNotification(
    listener: AppServerNotificationListener
  ): () => void {
    this.serverNotificationListeners.add(listener);
    return () => {
      this.serverNotificationListeners.delete(listener);
    };
  }

  public onServerRequest(listener: AppServerRequestListener): () => void {
    this.serverRequestListeners.add(listener);
    return () => {
      this.serverRequestListeners.delete(listener);
    };
  }

  private async sendErrorResponse(
    requestId: AppServerRequestId,
    code: number,
    message: string
  ): Promise<void> {
    const payload = JsonRpcResponseSchema.parse({
      id: requestId,
      error: {
        code,
        message
      }
    });
    await this.writePayload(payload, "error response");
  }

  private ensureStarted(): void {
    if (this.process) {
      return;
    }

    this.resetStdoutFrameState();

    const child = spawn(this.executablePath, ["app-server"], {
      cwd: this.cwd,
      env: {
        ...process.env,
        ...this.env,
        CODEX_USER_AGENT: this.userAgent,
        CODEX_CLIENT_ID: `farfield-${randomUUID()}`
      },
      shell: process.platform === "win32",
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });

    child.on("exit", (code, signal) => {
      this.resetStdoutFrameState();
      const reason = `app-server exited (code=${String(code)}, signal=${String(signal)})`;
      this.rejectAll(new AppServerTransportError(reason));
      this.process = null;
      this.initialized = false;
      this.initializeInFlight = null;
    });

    child.on("error", (error) => {
      this.resetStdoutFrameState();
      this.rejectAll(
        new AppServerTransportError(`app-server process error: ${error.message}`)
      );
      this.process = null;
      this.initialized = false;
      this.initializeInFlight = null;
    });

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (text: string) => {
      try {
        this.consumeStdoutText(text);
      } catch (error) {
        this.rejectAll(
          new AppServerTransportError(`invalid app-server stdout: ${String(error)}`)
        );
        child.kill("SIGTERM");
      }
    });

    const stderrReader = readline.createInterface({ input: child.stderr });
    stderrReader.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return;
      }

      this.onStderr?.(trimmed);
    });

    this.process = child;
  }

  private resetStdoutFrameState(): void {
    this.stdoutFrameBuffer = "";
    this.stdoutFrameDepth = 0;
    this.stdoutFrameInString = false;
    this.stdoutFrameEscaped = false;
  }

  private handleIncomingMessage(
    raw: Parameters<typeof parseJsonRpcIncomingMessage>[0]
  ): void {
    const message = parseJsonRpcIncomingMessage(raw);

    if (message.kind === "response") {
      const pending = this.pending.get(message.value.id);
      if (!pending) {
        return;
      }

      this.pending.delete(message.value.id);
      clearTimeout(pending.timer);

      if (message.value.error) {
        const responseError = JsonRpcErrorSchema.parse(message.value.error);
        pending.reject(
          new AppServerRpcError(
            responseError.code,
            responseError.message,
            responseError.data
          )
        );
        return;
      }

      pending.resolve(message.value.result);
      return;
    }

    if (message.kind === "request") {
      const parsedRequest = AppServerServerRequestSchema.safeParse(
        message.value
      );
      if (!parsedRequest.success) {
        void this.sendErrorResponse(
          message.value.id,
          -32600,
          `Unhandled app-server request: ${message.value.method}`
        ).catch(() => {});
        return;
      }

      const request = parsedRequest.data;
      for (const listener of this.serverRequestListeners) {
        listener(request);
      }
      return;
    }

    const parsedNotification = AppServerServerNotificationSchema.safeParse(
      message.value
    );
    if (!parsedNotification.success) {
      return;
    }

    const notification = parsedNotification.data;
    for (const listener of this.serverNotificationListeners) {
      listener(notification);
    }
  }

  private consumeStdoutText(text: string): void {
    for (const char of text) {
      if (this.stdoutFrameDepth === 0) {
        if (/\s/.test(char)) {
          continue;
        }
        if (char !== "{") {
          throw new AppServerTransportError(
            `app-server stdout started with unexpected character: ${JSON.stringify(char)}`
          );
        }
        this.resetStdoutFrameState();
        this.stdoutFrameDepth = 1;
        this.stdoutFrameBuffer = "{";
        continue;
      }

      if (this.stdoutFrameInString) {
        if (this.stdoutFrameEscaped) {
          this.stdoutFrameBuffer += escapeJsonControlCharacter(char);
          this.stdoutFrameEscaped = false;
          continue;
        }

        if (char === "\\") {
          this.stdoutFrameBuffer += char;
          this.stdoutFrameEscaped = true;
          continue;
        }

        if (char === "\"") {
          this.stdoutFrameBuffer += char;
          this.stdoutFrameInString = false;
          continue;
        }

        this.stdoutFrameBuffer += escapeJsonControlCharacter(char);
        continue;
      }

      this.stdoutFrameBuffer += char;

      if (char === "\"") {
        this.stdoutFrameInString = true;
        continue;
      }

      if (char === "{") {
        this.stdoutFrameDepth += 1;
        continue;
      }

      if (char === "}") {
        this.stdoutFrameDepth -= 1;
        if (this.stdoutFrameDepth < 0) {
          throw new AppServerTransportError("app-server stdout produced an unmatched closing brace");
        }
        if (this.stdoutFrameDepth === 0) {
          try {
            const raw = JSON.parse(this.stdoutFrameBuffer);
            this.resetStdoutFrameState();
            this.handleIncomingMessage(raw);
          } catch (error) {
            this.resetStdoutFrameState();
            throw new AppServerTransportError(
              `failed to process app-server message: ${String(error)}`
            );
          }
        }
      }
    }
  }

  private rejectAll(error: Error): void {
    for (const { timer, reject } of this.pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    this.pending.clear();
  }

  private async writePayload(
    payload:
      | JsonRpcRequest
      | z.output<typeof JsonRpcNotificationSchema>
      | z.output<typeof JsonRpcResponseSchema>,
    context: string
  ): Promise<void> {
    const processHandle = this.process;
    if (!processHandle) {
      throw new AppServerTransportError("app-server failed to start");
    }

    const encoded = `${JSON.stringify(payload)}\n`;
    await new Promise<void>((resolve, reject) => {
      processHandle.stdin.write(encoded, (error) => {
        if (!error) {
          resolve();
          return;
        }

        reject(
          new AppServerTransportError(
            `failed to write app-server ${context}: ${error.message}`
          )
        );
      });
    });
  }

  private async sendNotification(method: "initialized"): Promise<void> {
    const payload = JsonRpcNotificationSchema.parse({ method });
    await this.writePayload(payload, "notification");
  }

  private async sendRequest(
    method: AppServerClientRequestMethod,
    params: JsonRpcRequest["params"],
    timeoutMs?: number
  ): Promise<JsonRpcResponse["result"]> {
    const id = ++this.requestId;
    const timeout = timeoutMs ?? this.requestTimeoutMs;
    const requestPayload = JsonRpcRequestSchema.parse({
      id,
      method,
      ...(params !== undefined ? { params } : {})
    });

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new AppServerTransportError(`app-server request timed out: ${method}`)
        );
      }, timeout);

      this.pending.set(id, { timer, resolve, reject });

      void this.writePayload(requestPayload, "request").catch((error) => {
        const pending = this.pending.get(id);
        if (!pending) {
          return;
        }

        clearTimeout(pending.timer);
        this.pending.delete(id);
        pending.reject(error);
      });
    });
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (this.initializeInFlight) {
      return this.initializeInFlight;
    }

    this.initializeInFlight = (async () => {
      const capabilities = {
        ...(this.experimentalApi ? { experimentalApi: true } : {}),
        ...(this.optOutNotificationMethods.length > 0
          ? {
              optOutNotificationMethods: [...this.optOutNotificationMethods]
            }
          : {})
      };

      await this.sendRequest(
        "initialize",
        {
          clientInfo: {
            name: "farfield",
            version: "0.2.0"
          },
          ...(Object.keys(capabilities).length > 0 ? { capabilities } : {})
        },
        this.requestTimeoutMs
      );

      await this.sendNotification("initialized");
      this.initialized = true;
    })().finally(() => {
      this.initializeInFlight = null;
    });

    return this.initializeInFlight;
  }

  public async request(
    method: AppServerClientRequestMethod,
    params: JsonRpcRequest["params"],
    timeoutMs?: number
  ): Promise<JsonRpcResponse["result"]> {
    this.ensureStarted();

    if (method !== "initialize") {
      await this.ensureInitialized();
    }

    const result = await this.sendRequest(method, params, timeoutMs);
    if (method === "initialize") {
      this.initialized = true;
    }
    return result;
  }

  public async respond(
    requestId: AppServerRequestId,
    result: JsonRpcResponse["result"]
  ): Promise<void> {
    this.ensureStarted();
    await this.ensureInitialized();

    const payload = JsonRpcResponseSchema.parse({
      id: requestId,
      ...(result !== undefined ? { result } : { result: null })
    });
    await this.writePayload(payload, "response");
  }

  public async close(): Promise<void> {
    const processHandle = this.process;
    if (!processHandle) {
      return;
    }

    this.resetStdoutFrameState();
    this.process = null;
    this.initialized = false;
    this.initializeInFlight = null;
    this.rejectAll(new AppServerTransportError("app-server transport closed"));

    processHandle.kill("SIGTERM");
  }
}

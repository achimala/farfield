import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";
import { randomUUID } from "node:crypto";
import type { AppServerClientRequestMethod } from "@farfield/protocol";
import {
  AppServerRpcError,
  AppServerTransportError
} from "./errors.js";
import { JsonRpcRequestSchema, parseJsonRpcIncomingMessage } from "./json-rpc.js";

export interface AppServerTransport {
  request(method: AppServerClientRequestMethod, params: unknown, timeoutMs?: number): Promise<unknown>;
  close(): Promise<void>;
}

interface PendingRequest {
  timer: NodeJS.Timeout;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export interface ChildProcessAppServerTransportOptions {
  executablePath: string;
  userAgent: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  requestTimeoutMs?: number;
  onStderr?: (line: string) => void;
}

export class ChildProcessAppServerTransport implements AppServerTransport {
  private readonly executablePath: string;
  private readonly userAgent: string;
  private readonly cwd: string | undefined;
  private readonly env: NodeJS.ProcessEnv | undefined;
  private readonly requestTimeoutMs: number;
  private readonly onStderr: ((line: string) => void) | undefined;
  private process: ChildProcessWithoutNullStreams | null = null;
  private readonly pending = new Map<number, PendingRequest>();
  private requestId = 0;
  private initialized = false;
  private initializeInFlight: Promise<void> | null = null;

  public constructor(options: ChildProcessAppServerTransportOptions) {
    this.executablePath = options.executablePath;
    this.userAgent = options.userAgent;
    this.cwd = options.cwd;
    this.env = options.env;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.onStderr = options.onStderr;
  }

  private ensureStarted(): void {
    if (this.process) {
      return;
    }

    const child = spawn(this.executablePath, ["app-server"], {
      cwd: this.cwd,
      env: {
        ...process.env,
        ...this.env,
        CODEX_USER_AGENT: this.userAgent,
        CODEX_CLIENT_ID: `farfield-${randomUUID()}`
      },
      stdio: ["pipe", "pipe", "pipe"]
    });

    child.on("exit", (code, signal) => {
      const reason = `app-server exited (code=${String(code)}, signal=${String(signal)})`;
      this.rejectAll(new AppServerTransportError(reason));
      this.process = null;
      this.initialized = false;
      this.initializeInFlight = null;
    });

    child.on("error", (error) => {
      this.rejectAll(new AppServerTransportError(`app-server process error: ${error.message}`));
      this.process = null;
      this.initialized = false;
      this.initializeInFlight = null;
    });

    const lineReader = readline.createInterface({ input: child.stdout });
    lineReader.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return;
      }

      const raw = JSON.parse(trimmed);
      const message = parseJsonRpcIncomingMessage(raw);

      if (message.kind === "notification") {
        return;
      }

      const pending = this.pending.get(message.value.id);
      if (!pending) {
        return;
      }

      this.pending.delete(message.value.id);
      clearTimeout(pending.timer);

      if (message.value.error) {
        pending.reject(
          new AppServerRpcError(
            message.value.error.code,
            message.value.error.message,
            message.value.error.data
          )
        );
        return;
      }

      pending.resolve(message.value.result);
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

  private rejectAll(error: Error): void {
    for (const { timer, reject } of this.pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    this.pending.clear();
  }

  private async sendRequest(
    method: AppServerClientRequestMethod,
    params: unknown,
    timeoutMs?: number
  ): Promise<unknown> {
    const processHandle = this.process;
    if (!processHandle) {
      throw new AppServerTransportError("app-server failed to start");
    }

    const id = ++this.requestId;
    const timeout = timeoutMs ?? this.requestTimeoutMs;
    const requestPayload = JsonRpcRequestSchema.parse({
      jsonrpc: "2.0",
      id,
      method,
      params
    });
    const encoded = JSON.stringify(requestPayload) + "\n";

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new AppServerTransportError(`app-server request timed out: ${method}`));
      }, timeout);

      this.pending.set(id, { timer, resolve, reject });

      processHandle.stdin.write(encoded, (error) => {
        if (!error) {
          return;
        }

        const pending = this.pending.get(id);
        if (!pending) {
          return;
        }

        clearTimeout(pending.timer);
        this.pending.delete(id);
        pending.reject(new AppServerTransportError(`failed to write app-server request: ${error.message}`));
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
      const result = await this.sendRequest(
        "initialize",
        {
          clientInfo: {
            name: "farfield",
            version: "0.2.0"
          },
          capabilities: {
            experimentalApi: true
          }
        },
        this.requestTimeoutMs
      );

      if (!result || typeof result !== "object") {
        throw new AppServerTransportError("app-server initialize returned invalid result");
      }

      this.initialized = true;
    })().finally(() => {
      this.initializeInFlight = null;
    });

    return this.initializeInFlight;
  }

  public async request(
    method: AppServerClientRequestMethod,
    params: unknown,
    timeoutMs?: number
  ): Promise<unknown> {
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

  public async close(): Promise<void> {
    const processHandle = this.process;
    if (!processHandle) {
      return;
    }

    this.process = null;
    this.initialized = false;
    this.initializeInFlight = null;
    this.rejectAll(new AppServerTransportError("app-server transport closed"));

    processHandle.kill("SIGTERM");
  }
}

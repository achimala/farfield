import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";
import { randomUUID } from "node:crypto";
import { AppServerError } from "./errors.js";
import { JsonRpcRequestSchema, parseJsonRpcResponse } from "./json-rpc.js";

export interface AppServerTransport {
  request(method: string, params: unknown, timeoutMs?: number): Promise<unknown>;
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
}

export class ChildProcessAppServerTransport implements AppServerTransport {
  private readonly executablePath: string;
  private readonly userAgent: string;
  private readonly cwd: string | undefined;
  private readonly env: NodeJS.ProcessEnv | undefined;
  private readonly requestTimeoutMs: number;
  private process: ChildProcessWithoutNullStreams | null = null;
  private readonly pending = new Map<number, PendingRequest>();
  private requestId = 0;

  public constructor(options: ChildProcessAppServerTransportOptions) {
    this.executablePath = options.executablePath;
    this.userAgent = options.userAgent;
    this.cwd = options.cwd;
    this.env = options.env;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
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
        CODEX_CLIENT_ID: `codex-monitor-${randomUUID()}`
      },
      stdio: ["pipe", "pipe", "pipe"]
    });

    child.on("exit", (code, signal) => {
      const reason = `app-server exited (code=${String(code)}, signal=${String(signal)})`;
      this.rejectAll(new AppServerError(reason));
      this.process = null;
    });

    child.on("error", (error) => {
      this.rejectAll(new AppServerError(`app-server process error: ${error.message}`));
      this.process = null;
    });

    const lineReader = readline.createInterface({ input: child.stdout });
    lineReader.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return;
      }

      let raw: unknown;
      try {
        raw = JSON.parse(trimmed);
      } catch {
        this.rejectAll(new AppServerError("app-server returned invalid JSON"));
        return;
      }

      let message;
      try {
        message = parseJsonRpcResponse(raw);
      } catch (error) {
        this.rejectAll(
          new AppServerError(
            `app-server response schema mismatch: ${error instanceof Error ? error.message : String(error)}`
          )
        );
        return;
      }

      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }

      this.pending.delete(message.id);
      clearTimeout(pending.timer);

      if (message.error) {
        pending.reject(
          new AppServerError(
            `app-server error ${message.error.code}: ${message.error.message}`
          )
        );
        return;
      }

      pending.resolve(message.result);
    });

    child.stderr.on("data", (chunk) => {
      const text = String(chunk).trim();
      if (!text) {
        return;
      }
      this.rejectAll(new AppServerError(`app-server stderr: ${text}`));
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

  public async request(method: string, params: unknown, timeoutMs?: number): Promise<unknown> {
    this.ensureStarted();
    const processHandle = this.process;
    if (!processHandle) {
      throw new AppServerError("app-server failed to start");
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
        reject(new AppServerError(`app-server request timed out: ${method}`));
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
        pending.reject(new AppServerError(`failed to write app-server request: ${error.message}`));
      });
    });
  }

  public async close(): Promise<void> {
    const processHandle = this.process;
    if (!processHandle) {
      return;
    }

    this.process = null;
    this.rejectAll(new AppServerError("app-server transport closed"));

    processHandle.kill("SIGTERM");
  }
}

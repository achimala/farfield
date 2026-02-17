import { EventEmitter } from "node:events";
import net from "node:net";
import {
  IpcBroadcastFrameSchema,
  IpcFrameSchema,
  IpcRequestFrameSchema,
  IpcResponseFrameSchema,
  type IpcBroadcastFrame,
  type IpcFrame,
  type IpcResponseFrame,
  parseIpcFrame
} from "@codex-monitor/codex-protocol";
import { DesktopIpcError } from "./errors.js";

interface PendingRequest {
  method: string;
  timer: NodeJS.Timeout;
  resolve: (value: IpcResponseFrame) => void;
  reject: (error: Error) => void;
}

export interface SendRequestOptions {
  targetClientId?: string;
  version?: number;
  timeoutMs?: number;
}

export interface DesktopIpcClientOptions {
  socketPath: string;
  requestTimeoutMs?: number;
}

export type IpcFrameListener = (frame: IpcFrame) => void;

export class DesktopIpcClient {
  private readonly socketPath: string;
  private readonly requestTimeoutMs: number;
  private socket: net.Socket | null = null;
  private buffer = Buffer.alloc(0);
  private requestId = 0;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly events = new EventEmitter();

  public constructor(options: DesktopIpcClientOptions) {
    this.socketPath = options.socketPath;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 20_000;
  }

  public onFrame(listener: IpcFrameListener): () => void {
    this.events.on("frame", listener);
    return () => this.events.off("frame", listener);
  }

  public async connect(): Promise<void> {
    if (this.socket) {
      throw new DesktopIpcError("IPC client is already connected");
    }

    this.socket = await new Promise<net.Socket>((resolve, reject) => {
      const socket = net.createConnection(this.socketPath);

      socket.once("connect", () => resolve(socket));
      socket.once("error", (error) => reject(new DesktopIpcError(error.message)));
    });

    this.socket.on("data", (chunk) => this.handleData(chunk));
    this.socket.on("close", () => {
      this.rejectAll(new DesktopIpcError("IPC socket closed"));
      this.socket = null;
      this.buffer = Buffer.alloc(0);
    });
    this.socket.on("error", (error) => {
      this.rejectAll(new DesktopIpcError(`IPC socket error: ${error.message}`));
    });
  }

  public async disconnect(): Promise<void> {
    const socket = this.socket;
    if (!socket) {
      return;
    }

    this.socket = null;
    this.rejectAll(new DesktopIpcError("IPC client disconnected"));

    await new Promise<void>((resolve) => {
      socket.once("close", () => resolve());
      socket.end();
    });
  }

  private rejectAll(error: Error): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
  }

  private ensureSocket(): net.Socket {
    if (!this.socket) {
      throw new DesktopIpcError("IPC socket is not connected");
    }
    return this.socket;
  }

  private emitFrame(frame: IpcFrame): void {
    this.events.emit("frame", frame);
  }

  private handleData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (this.buffer.length >= 4) {
      const size = this.buffer.readUInt32BE(0);
      if (this.buffer.length < 4 + size) {
        return;
      }

      const payloadBuffer = this.buffer.slice(4, 4 + size);
      this.buffer = this.buffer.slice(4 + size);

      let raw: unknown;
      try {
        raw = JSON.parse(payloadBuffer.toString("utf8"));
      } catch {
        this.rejectAll(new DesktopIpcError("IPC frame contained invalid JSON"));
        return;
      }

      const frame = parseIpcFrame(raw);
      this.emitFrame(frame);

      if (frame.type !== "response") {
        continue;
      }

      const pending = this.pending.get(frame.requestId);
      if (!pending) {
        continue;
      }

      this.pending.delete(frame.requestId);
      clearTimeout(pending.timer);

      if (frame.error) {
        pending.reject(
          new DesktopIpcError(
            `IPC ${pending.method} failed: ${
              typeof frame.error === "string" ? frame.error : JSON.stringify(frame.error)
            }`
          )
        );
        continue;
      }

      pending.resolve(IpcResponseFrameSchema.parse(frame));
    }
  }

  private writeFrame(frame: unknown): void {
    const socket = this.ensureSocket();
    const encoded = Buffer.from(JSON.stringify(frame), "utf8");
    const header = Buffer.alloc(4);
    header.writeUInt32BE(encoded.length, 0);
    socket.write(Buffer.concat([header, encoded]));
  }

  public sendBroadcast(method: string, params: unknown, options: SendRequestOptions = {}): void {
    const frame = IpcBroadcastFrameSchema.parse({
      type: "broadcast",
      method,
      params,
      targetClientId: options.targetClientId,
      version: options.version
    });

    this.writeFrame(frame);
  }

  public async sendRequestAndWait(
    method: string,
    params: unknown,
    options: SendRequestOptions = {}
  ): Promise<IpcResponseFrame> {
    const requestId = ++this.requestId;

    const frame = IpcRequestFrameSchema.parse({
      type: "request",
      requestId,
      method,
      params,
      targetClientId: options.targetClientId,
      version: options.version
    });

    const timeout = options.timeoutMs ?? this.requestTimeoutMs;

    const responsePromise = new Promise<IpcResponseFrame>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new DesktopIpcError(`IPC request timed out: ${method}`));
      }, timeout);

      this.pending.set(requestId, {
        method,
        timer,
        resolve,
        reject
      });
    });

    this.writeFrame(frame);
    return responsePromise;
  }

  public async initialize(userAgent: string): Promise<IpcResponseFrame> {
    const requestId = ++this.requestId;
    const frame = IpcFrameSchema.parse({
      type: "initialize",
      requestId,
      params: {
        clientName: "codex-monitor",
        clientVersion: "0.2.0",
        userAgent
      }
    });

    const responsePromise = new Promise<IpcResponseFrame>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new DesktopIpcError("IPC initialize request timed out"));
      }, this.requestTimeoutMs);

      this.pending.set(requestId, {
        method: "initialize",
        timer,
        resolve,
        reject
      });
    });

    this.writeFrame(frame);
    return responsePromise;
  }
}

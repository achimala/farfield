import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import net from "node:net";
import {
  IpcBroadcastFrameSchema,
  IpcClientDiscoveryResponseFrameSchema,
  IpcFrameSchema,
  IpcRequestFrameSchema,
  IpcResponseFrameSchema,
  type IpcFrame,
  type IpcResponseFrame,
  parseIpcFrame
} from "@farfield/protocol";
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
export interface IpcConnectionState {
  connected: boolean;
  reason?: string;
}
export type IpcConnectionListener = (state: IpcConnectionState) => void;

const MAX_FRAME_SIZE_BYTES = 256 * 1024 * 1024;
const INITIALIZING_CLIENT_ID = "initializing-client";

export class DesktopIpcClient {
  private readonly socketPath: string;
  private readonly requestTimeoutMs: number;
  private socket: net.Socket | null = null;
  private buffer = Buffer.alloc(0);
  private clientId: string | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly events = new EventEmitter();

  public constructor(options: DesktopIpcClientOptions) {
    this.socketPath = options.socketPath;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 20_000;
  }

  public onFrame(listener: IpcFrameListener): () => void {
    this.events.on("frame", listener);
    return () => this.events.off("frame", listener);
  }

  public onConnectionState(listener: IpcConnectionListener): () => void {
    this.events.on("connection-state", listener);
    return () => this.events.off("connection-state", listener);
  }

  public isConnected(): boolean {
    return this.socket !== null;
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
      this.clientId = null;
      this.emitConnectionState({
        connected: false,
        reason: "IPC socket closed"
      });
    });
    this.socket.on("error", (error) => {
      this.rejectAll(new DesktopIpcError(`IPC socket error: ${error.message}`));
      this.emitConnectionState({
        connected: false,
        reason: `IPC socket error: ${error.message}`
      });
    });

    this.emitConnectionState({ connected: true });
  }

  public async disconnect(): Promise<void> {
    const socket = this.socket;
    if (!socket) {
      return;
    }

    this.socket = null;
    this.clientId = null;
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

  private emitConnectionState(state: IpcConnectionState): void {
    this.events.emit("connection-state", state);
  }

  private writeFrame(frame: unknown): void {
    const socket = this.ensureSocket();
    const encoded = Buffer.from(JSON.stringify(frame), "utf8");
    const header = Buffer.alloc(4);
    header.writeUInt32LE(encoded.length, 0);
    socket.write(Buffer.concat([header, encoded]));
  }

  private respondClientDiscovery(requestId: string): void {
    const response = IpcClientDiscoveryResponseFrameSchema.parse({
      type: "client-discovery-response",
      requestId,
      response: {
        canHandle: false
      }
    });

    this.writeFrame(response);
  }

  private respondNoHandler(requestId: string): void {
    const response = IpcResponseFrameSchema.parse({
      type: "response",
      requestId,
      resultType: "error",
      error: "no-handler-for-request"
    });

    this.writeFrame(response);
  }

  private handleData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (this.buffer.length >= 4) {
      const size = this.buffer.readUInt32LE(0);
      if (size > MAX_FRAME_SIZE_BYTES) {
        this.rejectAll(
          new DesktopIpcError(
            `IPC frame exceeded limit (${String(size)} > ${String(MAX_FRAME_SIZE_BYTES)})`
          )
        );
        this.socket?.destroy();
        return;
      }

      if (this.buffer.length < 4 + size) {
        return;
      }

      const payloadBuffer = this.buffer.slice(4, 4 + size);
      this.buffer = this.buffer.slice(4 + size);

      const raw = JSON.parse(payloadBuffer.toString("utf8"));
      const frame = parseIpcFrame(raw);
      this.emitFrame(frame);

      if (frame.type === "client-discovery-request") {
        this.respondClientDiscovery(frame.requestId);
        continue;
      }

      if (frame.type === "request") {
        this.respondNoHandler(frame.requestId);
        continue;
      }

      if (frame.type !== "response") {
        continue;
      }

      const pending = this.pending.get(frame.requestId);
      if (!pending) {
        continue;
      }

      this.pending.delete(frame.requestId);
      clearTimeout(pending.timer);

      if (frame.resultType === "error") {
        pending.reject(
          new DesktopIpcError(
            `IPC ${pending.method} failed: ${
              typeof frame.error === "string" ? frame.error : JSON.stringify(frame.error)
            }`
          )
        );
        continue;
      }

      const result = frame.result;
      if (
        frame.method === "initialize" &&
        result &&
        typeof result === "object" &&
        typeof (result as Record<string, unknown>)["clientId"] === "string"
      ) {
        this.clientId = (result as Record<string, unknown>)["clientId"] as string;
      }

      pending.resolve(IpcResponseFrameSchema.parse(frame));
    }
  }

  public sendBroadcast(method: string, params: unknown, options: SendRequestOptions = {}): void {
    const frame = IpcBroadcastFrameSchema.parse({
      type: "broadcast",
      method,
      params,
      sourceClientId: this.clientId ?? INITIALIZING_CLIENT_ID,
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
    const requestId = randomUUID();

    const frame = IpcRequestFrameSchema.parse({
      type: "request",
      requestId,
      method,
      params,
      sourceClientId: this.clientId ?? INITIALIZING_CLIENT_ID,
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

  public async initialize(_userAgent: string): Promise<IpcResponseFrame> {
    const requestId = randomUUID();
    const frame = IpcRequestFrameSchema.parse({
      type: "request",
      requestId,
      sourceClientId: INITIALIZING_CLIENT_ID,
      version: 1,
      method: "initialize",
      params: {
        clientType: "farfield"
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

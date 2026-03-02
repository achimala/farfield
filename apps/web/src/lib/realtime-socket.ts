import {
  UnifiedRealtimeClientMessageSchema,
  UnifiedRealtimeServerMessageSchema,
  type JsonValue,
  type UnifiedRealtimeClientMessage,
  type UnifiedRealtimeServerMessage,
} from "@farfield/unified-surface";
import { io, type Socket } from "socket.io-client";

const REALTIME_CLIENT_EVENT = "unified-realtime-client-message";
const REALTIME_SERVER_EVENT = "unified-realtime-server-message";

export interface UnifiedRealtimeSocket {
  connect(): void;
  disconnect(): void;
  send(message: UnifiedRealtimeClientMessage): void;
}

export function createUnifiedRealtimeSocket(input: {
  socketUrl: string;
  onMessage: (message: UnifiedRealtimeServerMessage) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onProtocolError?: (message: string) => void;
}): UnifiedRealtimeSocket {
  const parsedSocketUrl = new URL(input.socketUrl);
  const socket: Socket = io(
    `${parsedSocketUrl.protocol}//${parsedSocketUrl.host}`,
    {
      path: parsedSocketUrl.pathname,
      transports: ["websocket"],
      autoConnect: false,
      reconnection: true,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 10_000,
    },
  );

  socket.on("connect", () => {
    input.onConnect?.();
  });

  socket.on("disconnect", () => {
    input.onDisconnect?.();
  });

  socket.on(REALTIME_SERVER_EVENT, (payload: JsonValue) => {
    const parsed = UnifiedRealtimeServerMessageSchema.safeParse(payload);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join(" | ");
      input.onProtocolError?.(`Invalid realtime payload: ${issues}`);
      return;
    }
    input.onMessage(parsed.data);
  });

  return {
    connect(): void {
      socket.connect();
    },
    disconnect(): void {
      socket.disconnect();
    },
    send(message: UnifiedRealtimeClientMessage): void {
      const parsed = UnifiedRealtimeClientMessageSchema.parse(message);
      socket.emit(REALTIME_CLIENT_EVENT, parsed);
    },
  };
}

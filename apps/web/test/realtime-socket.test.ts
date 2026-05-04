import { describe, expect, it, vi } from "vitest";
import { createUnifiedRealtimeSocket } from "../src/lib/realtime-socket";

const { ioMock } = vi.hoisted(() => ({
  ioMock: vi.fn(() => ({
    on: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    emit: vi.fn(),
  })),
}));

vi.mock("socket.io-client", () => ({
  io: ioMock,
}));

describe("createUnifiedRealtimeSocket", () => {
  it("passes the auth token to socket.io when configured", () => {
    createUnifiedRealtimeSocket({
      socketUrl: "wss://farfield.example.com/api/unified/ws",
      authToken: "secret",
      onMessage: vi.fn(),
    });

    expect(ioMock).toHaveBeenCalledWith(
      "wss://farfield.example.com",
      expect.objectContaining({
        path: "/api/unified/ws",
        auth: { token: "secret" },
      }),
    );
  });
});

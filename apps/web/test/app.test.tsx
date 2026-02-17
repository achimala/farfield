import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { App } from "../src/App";

class MockEventSource {
  public onmessage: ((event: MessageEvent<string>) => void) | null = null;
  public onerror: ((event: Event) => void) | null = null;

  public constructor(_url: string) {}

  public close(): void {}
}

vi.stubGlobal("EventSource", MockEventSource);

vi.stubGlobal(
  "fetch",
  vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url.includes("/api/health")) {
      return {
        ok: true,
        json: async () => ({
          ok: true,
          state: {
            appReady: true,
            ipcConnected: true,
            ipcInitialized: true,
            lastError: null,
            historyCount: 0,
            threadOwnerCount: 0
          }
        })
      } as Response;
    }

    if (url.includes("/api/threads") && !url.includes("/live-state")) {
      return {
        ok: true,
        json: async () => ({
          ok: true,
          data: [],
          nextCursor: null,
          pages: 0,
          truncated: false
        })
      } as Response;
    }

    if (url.includes("/api/collaboration-modes")) {
      return {
        ok: true,
        json: async () => ({
          ok: true,
          data: [
            {
              name: "Plan",
              mode: "plan",
              model: null,
              reasoning_effort: "medium",
              developer_instructions: "x"
            }
          ]
        })
      } as Response;
    }

    if (url.includes("/api/debug/trace/status")) {
      return {
        ok: true,
        json: async () => ({
          ok: true,
          active: null,
          recent: []
        })
      } as Response;
    }

    if (url.includes("/api/debug/history")) {
      return {
        ok: true,
        json: async () => ({
          ok: true,
          history: []
        })
      } as Response;
    }

    return {
      ok: true,
      json: async () => ({
        ok: true,
        threadId: "t",
        ownerClientId: null,
        conversationState: null,
        events: []
      })
    } as Response;
  })
);

describe("App", () => {
  it("renders core sections", async () => {
    render(<App />);
    expect(await screen.findByText("Threads")).toBeTruthy();
    expect(await screen.findByText("Chat")).toBeTruthy();
    expect(await screen.findByText("Debug")).toBeTruthy();
  });
});

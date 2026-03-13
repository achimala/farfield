import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChildProcessAppServerTransport } from "../src/app-server-transport.js";

class MockChildProcess extends EventEmitter {
  public readonly stdin = new PassThrough();
  public readonly stdout = new PassThrough();
  public readonly stderr = new PassThrough();
  public readonly stdio = [this.stdin, this.stdout, this.stderr] as const;
  public readonly kill = vi.fn();
}

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return {
    ...actual,
    spawn: spawnMock
  };
});

describe("ChildProcessAppServerTransport", () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  it("parses stdout responses that contain raw newlines inside strings", async () => {
    const child = new MockChildProcess();
    spawnMock.mockReturnValue(child as ChildProcessWithoutNullStreams);

    const transport = new ChildProcessAppServerTransport({
      executablePath: "/tmp/fake-codex",
      userAgent: "farfield-test"
    });

    const requestPromise = transport.request("initialize", {
      clientInfo: { name: "farfield", version: "0.2.0" },
      capabilities: { experimentalApi: true }
    });

    child.stdout.write(
      "{\"id\":1,\"result\":{\"threads\":[{\"preview\":\"line one\nline two\"}]}}\n"
    );

    await expect(requestPromise).resolves.toEqual({
      threads: [{ preview: "line one\nline two" }]
    });
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_PLATFORM_DESCRIPTOR = Object.getOwnPropertyDescriptor(
  process,
  "platform",
);

function setWindowsPlatform(): void {
  Object.defineProperty(process, "platform", {
    configurable: true,
    value: "win32",
  });
}

describe("buildSpawnSpec", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock("node:child_process");
    if (ORIGINAL_PLATFORM_DESCRIPTOR) {
      Object.defineProperty(process, "platform", ORIGINAL_PLATFORM_DESCRIPTOR);
    }
  });

  it("routes extensionless Codex paths through a sibling cmd shim on Windows", async () => {
    vi.doMock("node:child_process", () => ({
      execFileSync: vi.fn(),
      spawn: vi.fn(),
    }));

    setWindowsPlatform();
    const temporaryDirectory = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "farfield-codex-shim-"),
    );
    const executablePath = path.join(temporaryDirectory, "codex");
    await fs.promises.writeFile(`${executablePath}.cmd`, "@echo off\r\n", "utf8");

    try {
      const { buildSpawnSpec } = await import(
        "../src/app-server-transport.js"
      );
      const spawnSpec = buildSpawnSpec(executablePath, ["app-server"]);

      expect(spawnSpec.command).toBe(process.env["ComSpec"] || "cmd.exe");
      expect(spawnSpec.args[3]).toContain(`${executablePath}.cmd`);
    } finally {
      await fs.promises.rm(temporaryDirectory, {
        recursive: true,
        force: true,
      });
    }
  });

  it("routes bare Codex commands through where.exe lookup before spawning on Windows", async () => {
    const execFileSync = vi.fn(() => "C:\\Tools\\codex.cmd\r\n");
    vi.doMock("node:child_process", () => ({
      execFileSync,
      spawn: vi.fn(),
    }));

    setWindowsPlatform();
    const { buildSpawnSpec } = await import("../src/app-server-transport.js");
    const spawnSpec = buildSpawnSpec("codex", ["app-server"]);

    expect(execFileSync).toHaveBeenCalledWith("where.exe", ["codex.cmd"], {
      encoding: "utf8",
    });
    expect(spawnSpec.command).toBe(process.env["ComSpec"] || "cmd.exe");
    expect(spawnSpec.args[3]).toContain("C:\\Tools\\codex.cmd");
  });
});

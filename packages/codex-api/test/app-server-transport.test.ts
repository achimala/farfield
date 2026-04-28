import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ChildProcessAppServerTransport,
  type AppServerRequestId,
} from "../src/app-server-transport.js";

const tempDirectories: string[] = [];

async function readJsonFileWhenReady(
  filePath: string,
  minimumRecordCount = 1,
): Promise<Array<Record<string, object | string | number | null>>> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      const parsed = JSON.parse(raw) as Array<
        Record<string, object | string | number | null>
      >;
      if (parsed.length >= minimumRecordCount) {
        return parsed;
      }
    } catch {
      await new Promise((resolve) => {
        setTimeout(resolve, 25);
      });
      continue;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 25);
    });
  }

  throw new Error(`Timed out waiting for ${filePath}`);
}

function createFakeAppServer(): {
  executablePath: string;
  recordsPath: string;
} {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "farfield-app-server-"));
  tempDirectories.push(tempDir);

  const scriptPath = path.join(tempDir, "fake-codex.mjs");
  const executablePath = path.join(
    tempDir,
    process.platform === "win32" ? "fake-codex.cmd" : "fake-codex",
  );
  const recordsPath = path.join(tempDir, "records.json");
  const source = `#!/usr/bin/env node
import fs from "node:fs";
import readline from "node:readline";

const recordsPath = process.env["FAKE_APP_SERVER_RECORDS"];
if (!recordsPath) {
  throw new Error("FAKE_APP_SERVER_RECORDS is required");
}

const records = [];
const flush = () => {
  fs.writeFileSync(recordsPath, JSON.stringify(records, null, 2));
};

process.on("exit", flush);
process.on("SIGTERM", () => process.exit(0));

const reader = readline.createInterface({ input: process.stdin });
reader.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }

  const message = JSON.parse(trimmed);
  records.push(message);
  flush();

  if (message.method === "initialize") {
    process.stdout.write(JSON.stringify({
      id: message.id,
      result: {
        serverInfo: {
          name: "fake-app-server"
        }
      }
    }) + "\\n");
    return;
  }

  if (message.method === "initialized") {
    process.stdout.write(JSON.stringify({
      method: "codex/event/mcp_startup_update",
      params: {
        state: "starting"
      }
    }) + "\\n");
    process.stdout.write(JSON.stringify({
      method: "thread/status/changed",
      params: {
        threadId: "thread-1",
        status: {
          type: "active",
          activeFlags: ["waitingOnUserInput"]
        }
      }
    }) + "\\n");
    process.stdout.write(JSON.stringify({
      id: "request-1",
      method: "item/tool/requestUserInput",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "item-1",
        questions: [
          {
            header: "Pick",
            id: "pick",
            question: "Pick one",
            options: [
              {
                label: "A",
                description: "Option A"
              }
            ]
          }
        ]
      }
    }) + "\\n");
    return;
  }

  if (message.method === "model/list") {
    if (message.params?.limit === 2) {
      process.stdout.write(
        "{\\"id\\":" + message.id + ",\\"result\\":{\\"data\\":[{\\"preview\\":\\"line one" + String.fromCharCode(10) + "line two\\",\\"control\\":\\"a" + String.fromCharCode(0) + "b\\"}]}}\\n"
      );
      return;
    }

    if (message.params?.limit === 3) {
      const emoji = Buffer.from("😀", "utf8");
      const payload = Buffer.from(
        "{\\"id\\":" + message.id + ",\\"result\\":{\\"data\\":[{\\"emoji\\":\\"😀\\"}]}}\\n",
        "utf8"
      );
      const splitAt = payload.indexOf(emoji) + 2;
      process.stdout.write(payload.subarray(0, splitAt));
      setTimeout(() => {
        process.stdout.write(payload.subarray(splitAt));
      }, 0);
      return;
    }

    process.stdout.write(JSON.stringify({
      id: message.id,
      result: {
        data: []
      }
    }) + "\\n");
  }
});
`;

  if (process.platform === "win32") {
    fs.writeFileSync(scriptPath, source);
    fs.writeFileSync(
      executablePath,
      `@echo off\r\n"${process.execPath}" "${scriptPath}" %*\r\n`,
    );
  } else {
    fs.writeFileSync(executablePath, source, { mode: 0o755 });
  }
  return { executablePath, recordsPath };
}

afterEach(() => {
  while (tempDirectories.length > 0) {
    const tempDir = tempDirectories.pop();
    if (!tempDir) {
      continue;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("ChildProcessAppServerTransport", () => {
  it(
    "sends initialize then initialized and handles server notifications and requests",
    async () => {
      const { executablePath, recordsPath } = createFakeAppServer();
      const notifications: Array<{ method: string }> = [];
      const requestIds: AppServerRequestId[] = [];

      const transport = new ChildProcessAppServerTransport({
        executablePath,
        userAgent: "farfield-test",
        env: {
          FAKE_APP_SERVER_RECORDS: recordsPath,
        },
      });

      transport.onServerNotification((notification) => {
        notifications.push({ method: notification.method });
      });
      transport.onServerRequest((request) => {
        requestIds.push(request.id);
      });

      const result = await transport.request("model/list", { limit: 1 });
      expect(result).toEqual({ data: [] });

      await transport.respond("request-1", {
        answers: {
          pick: {
            answers: ["A"],
          },
        },
      });
      const records = await readJsonFileWhenReady(recordsPath, 4);
      await transport.close();

      expect(records[0]).toMatchObject({
        id: 1,
        method: "initialize",
        params: {
          clientInfo: {
            name: "farfield",
            version: "0.2.0",
          },
        },
      });
      expect(records[0]).not.toHaveProperty("jsonrpc");
      expect(records[1]).toEqual({
        method: "initialized",
      });
      expect(records[2]).toMatchObject({
        id: 2,
        method: "model/list",
        params: {
          limit: 1,
        },
      });
      expect(records[2]).not.toHaveProperty("jsonrpc");
      expect(records[3]).toEqual({
        id: "request-1",
        result: {
          answers: {
            pick: {
              answers: ["A"],
            },
          },
        },
      });

      expect(notifications).toEqual([{ method: "thread/status/changed" }]);
      expect(requestIds).toEqual(["request-1"]);
    },
    15_000,
  );

  it("parses stdout responses with raw control characters inside strings", async () => {
    const { executablePath, recordsPath } = createFakeAppServer();
    const stderrLines: string[] = [];

    const transport = new ChildProcessAppServerTransport({
      executablePath,
      userAgent: "farfield-test",
      env: {
        FAKE_APP_SERVER_RECORDS: recordsPath,
      },
      onStderr: (line) => {
        stderrLines.push(line);
      },
    });

    const result = await transport.request("model/list", { limit: 2 });
    await transport.close();

    expect(result).toEqual({
      data: [
        {
          preview: "line one\nline two",
          control: "a\u0000b",
        },
      ],
    });
    expect(stderrLines).toEqual([]);
  });

  it("parses stdout responses with split multi-byte UTF-8 characters", async () => {
    const { executablePath, recordsPath } = createFakeAppServer();
    const stderrLines: string[] = [];

    const transport = new ChildProcessAppServerTransport({
      executablePath,
      userAgent: "farfield-test",
      env: {
        FAKE_APP_SERVER_RECORDS: recordsPath,
      },
      onStderr: (line) => {
        stderrLines.push(line);
      },
    });

    const result = await transport.request("model/list", { limit: 3 });
    await transport.close();

    expect(result).toEqual({
      data: [
        {
          emoji: "😀",
        },
      ],
    });
    expect(stderrLines).toEqual([]);
  });
});

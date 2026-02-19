#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";

function usage() {
  console.error("Usage: node scripts/codex-window-screenshot.mjs [output-path] [--title <contains>]");
}

const args = process.argv.slice(2);
let outputPath = path.join(os.homedir(), "Desktop", "codex-app.png");
let titleFilter = "";

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === "--title") {
    const next = args[i + 1];
    if (!next) {
      usage();
      process.exit(2);
    }
    titleFilter = next;
    i += 1;
    continue;
  }

  if (arg.startsWith("--")) {
    usage();
    process.exit(2);
  }

  outputPath = path.resolve(arg);
}

const swiftScript = String.raw`import Foundation
import CoreGraphics

let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
let list = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] ?? []

struct WindowInfo {
  let id: UInt32
  let owner: String
  let name: String
}

let windows: [WindowInfo] = list.compactMap { item in
  guard let owner = item[kCGWindowOwnerName as String] as? String,
        let id = item[kCGWindowNumber as String] as? UInt32 else {
    return nil
  }
  let name = (item[kCGWindowName as String] as? String) ?? ""
  return WindowInfo(id: id, owner: owner, name: name)
}

let codexWindows = windows.filter { $0.owner == "Codex" }
if codexWindows.isEmpty {
  fputs("No Codex windows found.\\n", stderr)
  exit(1)
}

let titleFilter = ProcessInfo.processInfo.environment["CODEX_TITLE_FILTER"] ?? ""
let filtered = titleFilter.isEmpty
  ? codexWindows
  : codexWindows.filter { $0.name.localizedCaseInsensitiveContains(titleFilter) }

if filtered.isEmpty {
  fputs("No Codex windows matched --title filter.\\n", stderr)
  exit(1)
}

let chosen = filtered.first { !$0.name.isEmpty } ?? filtered[0]
print(chosen.id)
`;

let windowId = "";
try {
  windowId = execFileSync("swift", ["-e", swiftScript], {
    env: {
      ...process.env,
      CODEX_TITLE_FILTER: titleFilter
    },
    encoding: "utf8"
  }).trim();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Failed to resolve Codex window id: ${message}`);
  process.exit(1);
}

if (!windowId) {
  console.error("Could not resolve a Codex window id.");
  process.exit(1);
}

try {
  execFileSync("screencapture", ["-x", "-l", windowId, outputPath], {
    stdio: "pipe"
  });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Screenshot failed: ${message}`);
  process.exit(1);
}

console.log(outputPath);

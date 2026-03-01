#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();

const fileExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);
const blockedPatterns = [
  {
    name: "as any cast",
    regex: /\bas\s+any\b/g
  },
  {
    name: "as unknown cast",
    regex: /\bas\s+unknown\b/g
  },
  {
    name: "@ts-ignore",
    regex: /@ts-ignore\b/g
  },
  {
    name: "@ts-expect-error",
    regex: /@ts-expect-error\b/g
  },
  {
    name: "@ts-nocheck",
    regex: /@ts-nocheck\b/g
  }
];

function isSourceFile(filePath) {
  if (!(filePath.startsWith("apps/") || filePath.startsWith("packages/") || filePath.startsWith("scripts/"))) {
    return false;
  }

  if (
    filePath === "scripts/verify-no-cheats.mjs" ||
    filePath === "scripts/verify-no-provider-imports-in-ui.mjs"
  ) {
    return false;
  }

  if (filePath.startsWith("scripts/")) {
    return filePath.endsWith(".mjs") || filePath.endsWith(".js");
  }

  if (!filePath.includes("/src/")) {
    return false;
  }

  if (
    filePath.includes("/dist/") ||
    filePath.includes("/vendor/") ||
    filePath.includes("/generated/") ||
    filePath.includes("/node_modules/")
  ) {
    return false;
  }

  const extension = path.extname(filePath);
  return fileExtensions.has(extension);
}

function indexToLineColumn(text, index) {
  const linesUpToIndex = text.slice(0, index).split("\n");
  const line = linesUpToIndex.length;
  const column = linesUpToIndex[linesUpToIndex.length - 1].length + 1;
  return { line, column };
}

function listTrackedFiles() {
  const result = spawnSync("git", ["ls-files"], {
    cwd: repoRoot,
    encoding: "utf8"
  });

  if (result.status !== 0) {
    const stderr = result.stderr ? result.stderr.trim() : "";
    throw new Error(stderr.length > 0 ? stderr : "Failed to run git ls-files");
  }

  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => isSourceFile(line));
}

function collectViolationsForFile(filePath) {
  const absolutePath = path.join(repoRoot, filePath);
  const content = fs.readFileSync(absolutePath, "utf8");
  const violations = [];

  for (const blockedPattern of blockedPatterns) {
    blockedPattern.regex.lastIndex = 0;

    while (true) {
      const match = blockedPattern.regex.exec(content);
      if (!match) {
        break;
      }

      const at = indexToLineColumn(content, match.index);
      violations.push({
        filePath,
        line: at.line,
        column: at.column,
        rule: blockedPattern.name,
        text: match[0]
      });
    }
  }

  return violations;
}

function main() {
  const files = listTrackedFiles();
  const violations = [];

  for (const filePath of files) {
    const nextViolations = collectViolationsForFile(filePath);
    if (nextViolations.length > 0) {
      violations.push(...nextViolations);
    }
  }

  if (violations.length === 0) {
    process.stdout.write(`verify-no-cheats: OK (${files.length} files checked)\n`);
    return;
  }

  process.stderr.write("verify-no-cheats: blocked construct(s) found:\n");
  for (const violation of violations) {
    process.stderr.write(
      `  - ${violation.filePath}:${String(violation.line)}:${String(violation.column)} ${violation.rule} (${violation.text})\n`
    );
  }

  process.exit(1);
}

main();

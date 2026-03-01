#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();

const bannedImportPrefixes = [
  "@farfield/api",
  "@farfield/codex-api",
  "@farfield/opencode-api",
  "@opencode-ai/sdk"
];

const uiRoots = ["apps/web/src/", "apps/web/test/"];
const allowedExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const importRegex = /(?:import|export)\s[^"'`]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

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
    .filter((line) => uiRoots.some((root) => line.startsWith(root)))
    .filter((line) => allowedExtensions.has(path.extname(line)));
}

function indexToLineColumn(text, index) {
  const linesUpToIndex = text.slice(0, index).split("\n");
  const line = linesUpToIndex.length;
  const column = linesUpToIndex[linesUpToIndex.length - 1].length + 1;
  return { line, column };
}

function findViolations(filePath) {
  const absolutePath = path.join(repoRoot, filePath);
  const content = fs.readFileSync(absolutePath, "utf8");
  importRegex.lastIndex = 0;

  const violations = [];

  while (true) {
    const match = importRegex.exec(content);
    if (!match) {
      break;
    }

    const importPath = match[1] ?? match[2];
    if (!importPath) {
      continue;
    }

    const isBanned = bannedImportPrefixes.some(
      (prefix) => importPath === prefix || importPath.startsWith(`${prefix}/`)
    );

    if (!isBanned) {
      continue;
    }

    const at = indexToLineColumn(content, match.index);
    violations.push({
      filePath,
      line: at.line,
      column: at.column,
      importPath
    });
  }

  return violations;
}

function main() {
  const files = listTrackedFiles();
  const violations = [];

  for (const filePath of files) {
    const next = findViolations(filePath);
    if (next.length > 0) {
      violations.push(...next);
    }
  }

  if (violations.length === 0) {
    process.stdout.write(`verify-no-provider-imports-in-ui: OK (${files.length} files checked)\n`);
    return;
  }

  process.stderr.write("verify-no-provider-imports-in-ui: blocked provider import(s) found:\n");
  for (const violation of violations) {
    process.stderr.write(
      `  - ${violation.filePath}:${String(violation.line)}:${String(violation.column)} import \"${violation.importPath}\"\n`
    );
  }

  process.exit(1);
}

main();

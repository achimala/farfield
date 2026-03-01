#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();
const targetRoot = path.join(repoRoot, "packages", "codex-protocol", "src", "generated", "app-server");
const bunBinary = process.platform === "win32" ? "bun.exe" : "bun";

function listFiles(directory) {
  if (!fs.existsSync(directory)) {
    return [];
  }

  const stack = [directory];
  const files = [];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolute);
        continue;
      }
      if (entry.isFile()) {
        files.push(absolute);
      }
    }
  }

  files.sort((left, right) => left.localeCompare(right));
  return files;
}

function hashFile(filePath) {
  const hash = createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function snapshotDirectory(directory) {
  const snapshot = new Map();
  const files = listFiles(directory);
  for (const absolutePath of files) {
    const relativePath = path.relative(repoRoot, absolutePath);
    snapshot.set(relativePath, hashFile(absolutePath));
  }
  return snapshot;
}

function runGenerator() {
  const result = spawnSync(
    bunBinary,
    ["run", "--filter", "@farfield/protocol", "generate:app-server-zod"],
    {
      cwd: repoRoot,
      stdio: "inherit",
      env: process.env
    }
  );

  if (typeof result.status === "number") {
    if (result.status !== 0) {
      process.exit(result.status);
    }
    return;
  }

  if (result.error) {
    const message = result.error instanceof Error ? result.error.message : String(result.error);
    process.stderr.write(`${message}\n`);
  }
  process.exit(1);
}

function main() {
  const before = snapshotDirectory(targetRoot);
  runGenerator();
  const after = snapshotDirectory(targetRoot);

  const changed = [];
  const allPaths = new Set([...before.keys(), ...after.keys()]);

  for (const filePath of allPaths) {
    const beforeHash = before.get(filePath);
    const afterHash = after.get(filePath);
    if (beforeHash !== afterHash) {
      changed.push(filePath);
    }
  }

  if (changed.length === 0) {
    process.stdout.write("verify-codex-generated-clean: OK\n");
    return;
  }

  process.stderr.write("verify-codex-generated-clean: generated files changed after regeneration:\n");
  for (const filePath of changed) {
    process.stderr.write(`  - ${filePath}\n`);
  }

  process.exit(1);
}

main();

#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();
const targetFile = path.join(
  repoRoot,
  "packages",
  "opencode-api",
  "src",
  "generated",
  "OpenCodeManifest.ts"
);

const nodeBinary = process.execPath;

function hashFile(filePath) {
  const hash = createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function readCurrentHash() {
  if (!fs.existsSync(targetFile)) {
    return null;
  }
  return hashFile(targetFile);
}

function runGenerator() {
  const result = spawnSync(
    nodeBinary,
    ["scripts/generate-opencode-manifest.mjs"],
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
  const before = readCurrentHash();
  runGenerator();
  const after = readCurrentHash();

  if (before === after) {
    process.stdout.write("verify-opencode-generated-clean: OK\n");
    return;
  }

  process.stderr.write("verify-opencode-generated-clean: generated file changed after regeneration:\n");
  process.stderr.write("  - packages/opencode-api/src/generated/OpenCodeManifest.ts\n");
  process.exit(1);
}

main();

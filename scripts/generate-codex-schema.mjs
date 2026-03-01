#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const defaultOutDir = path.join(
  root,
  "packages",
  "codex-protocol",
  "vendor",
  "codex-app-server-schema"
);

function printHelp() {
  process.stdout.write(
    [
      "Usage: bun run generate:codex-schema [--out <dir>] [--codex <path>]",
      "",
      "Options:",
      "  --out <dir>      Output directory",
      "  --codex <path>   Path to codex executable",
      "  --help           Show this help message"
    ].join("\n")
  );
  process.stdout.write("\n");
}

function parseArgs(argv) {
  const result = {
    outDir: defaultOutDir,
    codexPath: ""
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }

    if (arg === "--out") {
      const nextArg = argv[index + 1];
      if (!nextArg || nextArg.startsWith("--")) {
        process.stderr.write("Missing value for --out\n");
        process.exit(1);
      }
      result.outDir = path.resolve(root, nextArg);
      index += 1;
      continue;
    }

    if (arg.startsWith("--out=")) {
      result.outDir = path.resolve(root, arg.slice("--out=".length));
      continue;
    }

    if (arg === "--codex") {
      const nextArg = argv[index + 1];
      if (!nextArg || nextArg.startsWith("--")) {
        process.stderr.write("Missing value for --codex\n");
        process.exit(1);
      }
      result.codexPath = nextArg;
      index += 1;
      continue;
    }

    if (arg.startsWith("--codex=")) {
      result.codexPath = arg.slice("--codex=".length);
      continue;
    }

    process.stderr.write(`Unknown argument: ${arg}\n`);
    process.exit(1);
  }

  return result;
}

function resolveCodexExecutable(explicitPath) {
  if (explicitPath.trim().length > 0) {
    return explicitPath;
  }

  if (process.env["CODEX_CLI_PATH"]) {
    return process.env["CODEX_CLI_PATH"];
  }

  const desktopPath = "/Applications/Codex.app/Contents/Resources/codex";
  if (fs.existsSync(desktopPath)) {
    return desktopPath;
  }

  return process.platform === "win32" ? "codex.cmd" : "codex";
}

function runCodex(codexExecutable, args, label) {
  const result = spawnSync(codexExecutable, args, {
    stdio: "inherit",
    env: process.env
  });

  if (result.error) {
    const message = result.error instanceof Error ? result.error.message : String(result.error);
    process.stderr.write(`Failed to run ${label}: ${message}\n`);
    if (String(message).includes("ENOENT")) {
      process.stderr.write(
        [
          "Could not find the codex executable.",
          "Install Codex CLI or pass --codex /path/to/codex.",
          "You can also set CODEX_CLI_PATH."
        ].join("\n")
      );
      process.stderr.write("\n");
    }
    return 1;
  }

  return typeof result.status === "number" ? result.status : 1;
}

function readCodexVersion(codexExecutable) {
  const result = spawnSync(codexExecutable, ["--version"], {
    encoding: "utf8",
    env: process.env
  });
  if (result.error || result.status !== 0) {
    return "unknown";
  }
  const text = (result.stdout ?? "").trim();
  return text.length > 0 ? text : "unknown";
}

function runBunScript(script, cwd) {
  const bunExecutable = process.platform === "win32" ? "bun.exe" : "bun";
  const result = spawnSync(bunExecutable, ["run", script], {
    cwd,
    stdio: "inherit",
    env: process.env
  });

  if (result.error) {
    const message = result.error instanceof Error ? result.error.message : String(result.error);
    process.stderr.write(`Failed to run ${script}: ${message}\n`);
    return 1;
  }

  return typeof result.status === "number" ? result.status : 1;
}

function generateVariant(codexExecutable, outDir, variantName, experimental) {
  const variantDir = path.join(outDir, variantName);
  const tsDir = path.join(variantDir, "typescript");
  const jsonDir = path.join(variantDir, "json");

  fs.rmSync(variantDir, { recursive: true, force: true });
  fs.mkdirSync(variantDir, { recursive: true });

  const extraArgs = experimental ? ["--experimental"] : [];

  const tsStatus = runCodex(
    codexExecutable,
    ["app-server", "generate-ts", "--out", tsDir, ...extraArgs],
    `${variantName} TypeScript schema generation`
  );
  if (tsStatus !== 0) {
    process.exit(tsStatus);
  }

  const jsonStatus = runCodex(
    codexExecutable,
    ["app-server", "generate-json-schema", "--out", jsonDir, ...extraArgs],
    `${variantName} JSON schema generation`
  );
  if (jsonStatus !== 0) {
    process.exit(jsonStatus);
  }
}

function writeMetadataFile(codexExecutable, outDir) {
  const metadata = {
    codexVersion: readCodexVersion(codexExecutable),
    outputs: {
      stable: {
        typescript: "stable/typescript",
        json: "stable/json"
      },
      experimental: {
        typescript: "experimental/typescript",
        json: "experimental/json"
      }
    }
  };

  fs.writeFileSync(path.join(outDir, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const codexExecutable = resolveCodexExecutable(args.codexPath);
  const outDir = args.outDir;

  fs.mkdirSync(outDir, { recursive: true });

  process.stdout.write(`Using codex executable: ${codexExecutable}\n`);
  process.stdout.write(`Writing schema outputs to: ${outDir}\n`);

  generateVariant(codexExecutable, outDir, "stable", false);
  generateVariant(codexExecutable, outDir, "experimental", true);
  writeMetadataFile(codexExecutable, outDir);

  const generateProtocolSchemasStatus = runBunScript(
    "generate:app-server-zod",
    path.join(root, "packages", "codex-protocol")
  );
  if (generateProtocolSchemasStatus !== 0) {
    process.exit(generateProtocolSchemasStatus);
  }

  process.stdout.write("Done. Generated stable and experimental schema outputs and protocol Zod modules.\n");
}

main();

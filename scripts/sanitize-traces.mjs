import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const inputDir = path.join(root, "traces");
const outputDir = path.join(root, "packages", "codex-protocol", "test", "fixtures", "sanitized");

const BANNED_PATTERNS = [
  /\/Users\//gi,
  /\\Users\\/gi,
  /github\.com/gi,
  /git@/gi,
  /https?:\/\//gi,
  /PRIVATE KEY/gi,
  /api[_-]?key/gi,
  /token/gi,
  /rollout-/gi
];
const ID_LIKE_KEYS = new Set([
  "id",
  "threadId",
  "conversationId",
  "turnId",
  "itemId",
  "sourceClientId",
  "targetClientId",
  "clientId",
  "entryId"
]);
const DROP_KEYS = new Set([
  "fullPayload",
  "aggregatedOutput",
  "originUrl",
  "command",
  "description",
  "developer_instructions",
  "message",
  "preview",
  "question",
  "header",
  "label",
  "title",
  "note",
  "text",
  "summary"
]);
const PATH_KEYS = new Set(["cwd", "path", "rolloutPath", "socketPath", "executablePath"]);
const SAFE_LITERAL_KEYS = new Set([
  "type",
  "method",
  "op",
  "resultType",
  "source",
  "direction",
  "mode",
  "status"
]);

const idMap = new Map();
let idCounter = 0;

function mapId(value, prefix = "id") {
  const key = String(value);
  if (idMap.has(key)) {
    return idMap.get(key);
  }
  idCounter += 1;
  const replacement = `${prefix}_${String(idCounter).padStart(4, "0")}`;
  idMap.set(key, replacement);
  return replacement;
}

function looksLikeId(value) {
  return (
    /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value) ||
    /^[0-9a-f]{32}$/i.test(value) ||
    /^\d{13,}$/.test(value) ||
    /^\d{10,}-.+/.test(value)
  );
}

function sanitizeString(key, value) {
  if (DROP_KEYS.has(key)) {
    return `[redacted ${key}]`;
  }

  if (PATH_KEYS.has(key) || value.includes("/Users/") || value.includes("\\\\.\\pipe")) {
    return "/redacted/path";
  }

  if (ID_LIKE_KEYS.has(key) || /Id$/.test(key) || looksLikeId(value)) {
    return mapId(value, key || "id");
  }

  if (SAFE_LITERAL_KEYS.has(key)) {
    return value;
  }

  if (key === "version") {
    return value;
  }

  return `[redacted ${key || "string"}]`;
}

function sanitizeNumber(key, value) {
  if (!Number.isFinite(value)) {
    return value;
  }

  if (/At$/.test(key) || /AtMs$/.test(key) || /startedAt/.test(key) || /updatedAt/.test(key)) {
    return 1700000000;
  }

  return value;
}

function sanitizeValue(value, key = "") {
  if (typeof value === "string") {
    return sanitizeString(key, value);
  }

  if (typeof value === "number") {
    return sanitizeNumber(key, value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, key));
  }

  if (value && typeof value === "object") {
    const result = {};
    for (const [nextKey, nextValue] of Object.entries(value)) {
      if (DROP_KEYS.has(nextKey)) {
        continue;
      }

      result[nextKey] = sanitizeValue(nextValue, nextKey);
    }
    return result;
  }

  return value;
}

function containsSensitiveContent(value) {
  const text = JSON.stringify(value);
  return BANNED_PATTERNS.some((pattern) => pattern.test(text));
}

function main() {
  if (!fs.existsSync(inputDir)) {
    console.log("No traces directory found. Nothing to sanitize.");
    return;
  }

  fs.mkdirSync(outputDir, { recursive: true });

  const files = fs
    .readdirSync(inputDir)
    .filter((name) => name.endsWith(".ndjson"))
    .sort();

  if (files.length === 0) {
    console.log("No NDJSON trace files found.");
    return;
  }

  for (const fileName of files) {
    const inputPath = path.join(inputDir, fileName);
    const outputPath = path.join(outputDir, fileName);

    const lines = fs.readFileSync(inputPath, "utf8").split("\n").filter(Boolean);
    const sanitizedLines = [];

    for (const line of lines) {
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }

      const sanitized = sanitizeValue(parsed);
      if (containsSensitiveContent(sanitized)) {
        throw new Error(`Sanitization failed for ${fileName}`);
      }

      sanitizedLines.push(JSON.stringify(sanitized));
    }

    fs.writeFileSync(outputPath, sanitizedLines.join("\n") + "\n", "utf8");
    console.log(`Sanitized ${fileName} -> ${path.relative(root, outputPath)}`);
  }
}

main();

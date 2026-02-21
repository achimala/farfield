#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import RefParser from "@apidevtools/json-schema-ref-parser";
import { jsonSchemaToZod } from "json-schema-to-zod";

const root = process.cwd();
const vendorRoot = path.join(root, "vendor", "codex-app-server-schema");
const outDir = path.join(root, "src", "generated", "app-server");

const schemaTargets = [
  {
    id: "thread-list-response",
    source: path.join(vendorRoot, "stable", "json", "v2", "ThreadListResponse.json"),
    fileName: "ThreadListResponseSchema.ts",
    exportName: "ThreadListResponseSchema"
  },
  {
    id: "thread-read-response",
    source: path.join(vendorRoot, "stable", "json", "v2", "ThreadReadResponse.json"),
    fileName: "ThreadReadResponseSchema.ts",
    exportName: "ThreadReadResponseSchema"
  },
  {
    id: "thread-start-params",
    source: path.join(vendorRoot, "stable", "json", "v2", "ThreadStartParams.json"),
    fileName: "ThreadStartParamsSchema.ts",
    exportName: "ThreadStartParamsSchema"
  },
  {
    id: "thread-start-response",
    source: path.join(vendorRoot, "stable", "json", "v2", "ThreadStartResponse.json"),
    fileName: "ThreadStartResponseSchema.ts",
    exportName: "ThreadStartResponseSchema"
  },
  {
    id: "model-list-response",
    source: path.join(vendorRoot, "stable", "json", "v2", "ModelListResponse.json"),
    fileName: "ModelListResponseSchema.ts",
    exportName: "ModelListResponseSchema"
  },
  {
    id: "send-user-message-params",
    source: path.join(vendorRoot, "stable", "json", "v1", "SendUserMessageParams.json"),
    fileName: "SendUserMessageParamsSchema.ts",
    exportName: "SendUserMessageParamsSchema"
  },
  {
    id: "send-user-message-response",
    source: path.join(vendorRoot, "stable", "json", "v1", "SendUserMessageResponse.json"),
    fileName: "SendUserMessageResponseSchema.ts",
    exportName: "SendUserMessageResponseSchema"
  },
  {
    id: "tool-request-user-input-response",
    source: path.join(vendorRoot, "stable", "json", "ToolRequestUserInputResponse.json"),
    fileName: "ToolRequestUserInputResponseSchema.ts",
    exportName: "ToolRequestUserInputResponseSchema"
  },
  {
    id: "collaboration-mode-list-response",
    source: path.join(vendorRoot, "experimental", "json", "v2", "CollaborationModeListResponse.json"),
    fileName: "CollaborationModeListResponseSchema.ts",
    exportName: "CollaborationModeListResponseSchema"
  }
];

const methodManifestSources = {
  clientRequest: [
    path.join(vendorRoot, "stable", "json", "ClientRequest.json"),
    path.join(vendorRoot, "experimental", "json", "ClientRequest.json")
  ],
  clientNotification: [
    path.join(vendorRoot, "stable", "json", "ClientNotification.json"),
    path.join(vendorRoot, "experimental", "json", "ClientNotification.json")
  ],
  serverRequest: [
    path.join(vendorRoot, "stable", "json", "ServerRequest.json"),
    path.join(vendorRoot, "experimental", "json", "ServerRequest.json")
  ],
  serverNotification: [
    path.join(vendorRoot, "stable", "json", "ServerNotification.json"),
    path.join(vendorRoot, "experimental", "json", "ServerNotification.json")
  ]
};

function ensureSchemaFilesExist() {
  const missing = schemaTargets.filter((target) => !fs.existsSync(target.source));
  const missingManifestSources = Object.entries(methodManifestSources)
    .flatMap(([name, sources]) =>
      sources
        .filter((source) => !fs.existsSync(source))
        .map((source) => ({ name, source }))
    );

  for (const entry of missingManifestSources) {
    missing.push({
      id: `method-manifest-${entry.name}`,
      source: entry.source,
      fileName: "",
      exportName: ""
    });
  }

  if (missing.length === 0) {
    return;
  }

  const names = missing.map((target) => target.source).join("\n");
  throw new Error(
    [
      "Missing generated Codex JSON Schema files.",
      "Run `bun run generate:codex-schema` first.",
      names
    ].join("\n")
  );
}

async function writeSchemaModule(target) {
  const dereferenced = await RefParser.dereference(target.source);
  const generated = jsonSchemaToZod(dereferenced, {
    name: target.exportName,
    module: "esm"
  });

  const withHeader = [
    "// GENERATED FILE. DO NOT EDIT.",
    `// Source: ${path.relative(root, target.source)}`,
    generated.trim(),
    ""
  ].join("\n");

  fs.writeFileSync(path.join(outDir, target.fileName), withHeader, "utf8");
}

function readMethodNames(sourcePaths) {
  const methodNames = new Set();

  for (const sourcePath of sourcePaths) {
    const schema = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
    if (!Array.isArray(schema.oneOf)) {
      throw new Error(`Expected oneOf array in ${sourcePath}`);
    }

    for (const branch of schema.oneOf) {
      const method = branch?.properties?.method;
      if (!method || !Array.isArray(method.enum) || method.enum.length !== 1) {
        continue;
      }
      const value = method.enum[0];
      if (typeof value === "string" && value.trim().length > 0) {
        methodNames.add(value);
      }
    }
  }

  return Array.from(methodNames).sort((left, right) => left.localeCompare(right));
}

function renderStringTuple(name, values) {
  const renderedValues = values.map((value) => `  ${JSON.stringify(value)}`).join(",\n");
  return [
    `export const ${name} = [`,
    renderedValues,
    "] as const;",
    ""
  ].join("\n");
}

function writeMethodManifestModule() {
  const clientRequestMethods = readMethodNames(methodManifestSources.clientRequest);
  const clientNotificationMethods = readMethodNames(methodManifestSources.clientNotification);
  const serverRequestMethods = readMethodNames(methodManifestSources.serverRequest);
  const serverNotificationMethods = readMethodNames(methodManifestSources.serverNotification);

  const lines = [
    "// GENERATED FILE. DO NOT EDIT.",
    ...methodManifestSources.clientRequest.map((source) => `// Source: ${path.relative(root, source)}`),
    ...methodManifestSources.clientNotification.map((source) => `// Source: ${path.relative(root, source)}`),
    ...methodManifestSources.serverRequest.map((source) => `// Source: ${path.relative(root, source)}`),
    ...methodManifestSources.serverNotification.map((source) => `// Source: ${path.relative(root, source)}`),
    "",
    renderStringTuple("APP_SERVER_CLIENT_REQUEST_METHODS", clientRequestMethods),
    "export type AppServerClientRequestMethod =",
    "  typeof APP_SERVER_CLIENT_REQUEST_METHODS[number];",
    "",
    renderStringTuple("APP_SERVER_CLIENT_NOTIFICATION_METHODS", clientNotificationMethods),
    "export type AppServerClientNotificationMethod =",
    "  typeof APP_SERVER_CLIENT_NOTIFICATION_METHODS[number];",
    "",
    renderStringTuple("APP_SERVER_SERVER_REQUEST_METHODS", serverRequestMethods),
    "export type AppServerServerRequestMethod =",
    "  typeof APP_SERVER_SERVER_REQUEST_METHODS[number];",
    "",
    renderStringTuple("APP_SERVER_SERVER_NOTIFICATION_METHODS", serverNotificationMethods),
    "export type AppServerServerNotificationMethod =",
    "  typeof APP_SERVER_SERVER_NOTIFICATION_METHODS[number];",
    ""
  ];

  fs.writeFileSync(path.join(outDir, "MethodManifest.ts"), lines.join("\n"), "utf8");
}

function writeIndexModule() {
  const exportLines = schemaTargets.map((target) => {
    const importPath = `./${target.fileName.replace(/\.ts$/, ".js")}`;
    return `export { ${target.exportName} } from "${importPath}";`;
  });
  exportLines.push('export * from "./MethodManifest.js";');
  const file = [
    "// GENERATED FILE. DO NOT EDIT.",
    ...exportLines,
    ""
  ].join("\n");
  fs.writeFileSync(path.join(outDir, "index.ts"), file, "utf8");
}

async function main() {
  ensureSchemaFilesExist();
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  for (const target of schemaTargets) {
    process.stdout.write(`Generating ${target.id}...\n`);
    await writeSchemaModule(target);
  }

  writeMethodManifestModule();
  writeIndexModule();
  process.stdout.write("Generated app-server Zod schema modules.\n");
}

await main();

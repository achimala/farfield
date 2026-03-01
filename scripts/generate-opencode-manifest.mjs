#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
const repoRoot = process.cwd();
const sdkTypeCandidates = [
  path.join(repoRoot, "packages", "opencode-api", "node_modules", "@opencode-ai", "sdk", "dist", "gen", "types.gen.d.ts"),
  path.join(repoRoot, "node_modules", "@opencode-ai", "sdk", "dist", "gen", "types.gen.d.ts")
];

const sdkTypesPath = (() => {
  for (const candidate of sdkTypeCandidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Unable to locate OpenCode SDK type declarations. Checked:\n${sdkTypeCandidates.join("\n")}`
  );
})();
const outputPath = path.join(
  repoRoot,
  "packages",
  "opencode-api",
  "src",
  "generated",
  "OpenCodeManifest.ts"
);

function assertSourceFile(filePath) {
  const program = ts.createProgram([filePath], {
    strict: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext
  });
  const checker = program.getTypeChecker();
  const sourceFile = program.getSourceFile(filePath);
  if (!sourceFile) {
    throw new Error(`Unable to read SDK type file: ${filePath}`);
  }
  return { checker, sourceFile };
}

function getExportedTypeAlias(checker, sourceFile, aliasName) {
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
  if (!moduleSymbol) {
    throw new Error(`Could not load module symbol from ${sourceFile.fileName}`);
  }

  const exported = checker.getExportsOfModule(moduleSymbol);
  const symbol = exported.find((entry) => entry.name === aliasName);
  if (!symbol) {
    throw new Error(`Type alias ${aliasName} was not found in ${sourceFile.fileName}`);
  }

  return checker.getDeclaredTypeOfSymbol(symbol);
}

function extractLiteralStringsFromType(type) {
  const variants = type.isUnion() ? type.types : [type];
  const values = [];

  for (const variant of variants) {
    if ((variant.flags & ts.TypeFlags.StringLiteral) === 0) {
      continue;
    }
    const literal = variant;
    values.push(literal.value);
  }

  return values;
}

function extractDiscriminantValues(checker, sourceFile, aliasName, propertyName) {
  const aliasType = getExportedTypeAlias(checker, sourceFile, aliasName);
  const variants = aliasType.isUnion() ? aliasType.types : [aliasType];
  const values = new Set();

  for (const variant of variants) {
    const property = variant.getProperty(propertyName);
    if (!property) {
      continue;
    }

    const propertyType = checker.getTypeOfSymbolAtLocation(property, sourceFile);
    const propertyValues = extractLiteralStringsFromType(propertyType);
    for (const value of propertyValues) {
      if (value.trim().length > 0) {
        values.add(value);
      }
    }
  }

  return Array.from(values).sort((left, right) => left.localeCompare(right));
}

function renderTupleConstant(constantName, values) {
  const renderedValues = values.map((value) => `  ${JSON.stringify(value)}`).join(",\n");
  return [
    `export const ${constantName} = [`,
    renderedValues,
    "] as const;",
    ""
  ].join("\n");
}

function writeManifestFile(manifest) {
  const lines = [
    "// GENERATED FILE. DO NOT EDIT.",
    `// Source: ${path.relative(repoRoot, sdkTypesPath)}`,
    "",
    renderTupleConstant("OPENCODE_EVENT_TYPES", manifest.eventTypes),
    "export type OpenCodeEventType = typeof OPENCODE_EVENT_TYPES[number];",
    "",
    renderTupleConstant("OPENCODE_PART_TYPES", manifest.partTypes),
    "export type OpenCodePartType = typeof OPENCODE_PART_TYPES[number];",
    "",
    renderTupleConstant("OPENCODE_TOOL_STATE_STATUSES", manifest.toolStateStatuses),
    "export type OpenCodeToolStateStatus = typeof OPENCODE_TOOL_STATE_STATUSES[number];",
    "",
    renderTupleConstant("OPENCODE_SESSION_STATUS_TYPES", manifest.sessionStatusTypes),
    "export type OpenCodeSessionStatusType = typeof OPENCODE_SESSION_STATUS_TYPES[number];",
    ""
  ];

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, lines.join("\n"), "utf8");
}

function main() {
  const { checker, sourceFile } = assertSourceFile(sdkTypesPath);

  const manifest = {
    eventTypes: extractDiscriminantValues(checker, sourceFile, "Event", "type"),
    partTypes: extractDiscriminantValues(checker, sourceFile, "Part", "type"),
    toolStateStatuses: extractDiscriminantValues(checker, sourceFile, "ToolState", "status"),
    sessionStatusTypes: extractDiscriminantValues(checker, sourceFile, "SessionStatus", "type")
  };

  if (manifest.eventTypes.length === 0) {
    throw new Error("No OpenCode event types were generated");
  }
  if (manifest.partTypes.length === 0) {
    throw new Error("No OpenCode part types were generated");
  }

  writeManifestFile(manifest);
  process.stdout.write(
    `Generated OpenCode manifest (${String(manifest.eventTypes.length)} events, ${String(manifest.partTypes.length)} parts).\n`
  );
}

main();

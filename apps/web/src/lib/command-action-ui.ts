export interface CommandActionForUi {
  type: string;
  command?: string | undefined;
  name?: string | undefined;
  path?: string | null | undefined;
  query?: string | null | undefined;
}

export type CommandActionIconKey =
  | "search"
  | "listFiles"
  | "write"
  | "read"
  | "readFile"
  | "writeFile"
  | "unknown";

export interface CommandActionPresentation {
  iconKey: CommandActionIconKey;
  text: string;
  tooltip?: string;
  rawCommand?: string;
}

interface ParsedLineRangeRead {
  path: string;
  startLine: number;
  endLine: number;
}

interface ParsedRgSearch {
  query: string | null;
  path: string | null;
}

const RG_OPTIONS_WITH_VALUE = new Set<string>([
  "-A",
  "-B",
  "-C",
  "-M",
  "-N",
  "-d",
  "-e",
  "-f",
  "-g",
  "-j",
  "-m",
  "-r",
  "-s",
  "-t",
  "-T",
  "-u",
  "-z",
  "--after-context",
  "--before-context",
  "--context",
  "--context-separator",
  "--dfa-size-limit",
  "--engine",
  "--field-context-separator",
  "--field-match-separator",
  "--glob",
  "--glob-case-insensitive",
  "--ignore-file",
  "--max-columns",
  "--max-depth",
  "--max-filesize",
  "--max-count",
  "--path-separator",
  "--pre",
  "--pre-glob",
  "--regex-size-limit",
  "--replace",
  "--sort",
  "--sortr",
  "--threads",
  "--type",
  "--type-add",
  "--type-clear",
  "--type-not",
]);

function normalizeText(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function shortenText(text: string, maxLength = 88): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}…`;
}

function unwrapShellWrapper(command: string): string {
  const trimmed = command.trim();
  const wrapperMatch = trimmed.match(/(?:^|\s)-lc\s+(['"])([\s\S]*)\1$/);
  const wrappedCommand = wrapperMatch?.[2];
  if (wrappedCommand == null) {
    return trimmed;
  }
  return wrappedCommand.trim();
}

function tokenizeShell(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaping = false;

  for (const char of command) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (char === "\\" && !inSingleQuote) {
      escaping = true;
      continue;
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (char === "\"" && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && /\s/.test(char)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && char === "|") {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      tokens.push("|");
      continue;
    }

    current += char;
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  if (escaping) {
    tokens.push("\\");
  }

  return tokens;
}

function splitPipeline(tokens: string[]): string[][] {
  const segments: string[][] = [];
  let currentSegment: string[] = [];

  for (const token of tokens) {
    if (token === "|") {
      if (currentSegment.length > 0) {
        segments.push(currentSegment);
      }
      currentSegment = [];
      continue;
    }
    currentSegment.push(token);
  }

  if (currentSegment.length > 0) {
    segments.push(currentSegment);
  }

  return segments;
}

function parseSedRangeToken(token: string): { startLine: number; endLine: number } | null {
  const rangeMatch = token.match(/^(\d+)(?:,(\d+))?p$/);
  if (rangeMatch == null) {
    return null;
  }

  const startLine = Number(rangeMatch[1]);
  const endLineValue = rangeMatch[2];
  const endLine = endLineValue != null ? Number(endLineValue) : startLine;

  if (
    !Number.isInteger(startLine) ||
    !Number.isInteger(endLine) ||
    startLine <= 0 ||
    endLine <= 0
  ) {
    return null;
  }

  return {
    startLine,
    endLine,
  };
}

function findFirstPositionalToken(
  tokens: string[],
  startIndex: number,
): string | null {
  for (let index = startIndex; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token == null || token.length === 0) {
      continue;
    }
    if (token === "--" || token.startsWith("-")) {
      continue;
    }
    return token;
  }
  return null;
}

function findLastPositionalToken(tokens: string[]): string | null {
  for (let index = tokens.length - 1; index >= 1; index -= 1) {
    const token = tokens[index];
    if (token == null || token.length === 0) {
      continue;
    }
    if (token === "--" || token.startsWith("-")) {
      continue;
    }
    return token;
  }
  return null;
}

function parseReadRangeFromCommand(
  command: string,
  actionPath: string | null,
): ParsedLineRangeRead | null {
  const tokens = tokenizeShell(unwrapShellWrapper(command));
  const segments = splitPipeline(tokens);

  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
    const segment = segments[segmentIndex];
    if (segment == null || segment[0] !== "sed") {
      continue;
    }

    for (let tokenIndex = 1; tokenIndex < segment.length; tokenIndex += 1) {
      const token = segment[tokenIndex];
      if (token == null) {
        continue;
      }
      const range = parseSedRangeToken(token);
      if (range == null) {
        continue;
      }

      const directPath = findFirstPositionalToken(segment, tokenIndex + 1);
      const previousSegment = segmentIndex > 0 ? segments[segmentIndex - 1] : null;
      const pipedPath =
        previousSegment != null ? findLastPositionalToken(previousSegment) : null;
      const path = directPath ?? pipedPath ?? actionPath;
      if (path == null) {
        continue;
      }

      return {
        path,
        startLine: range.startLine,
        endLine: range.endLine,
      };
    }
  }

  return null;
}

function optionConsumesNextValue(option: string): boolean {
  if (RG_OPTIONS_WITH_VALUE.has(option)) {
    return true;
  }
  if (option.startsWith("--")) {
    return false;
  }
  return option.length === 2 && RG_OPTIONS_WITH_VALUE.has(option);
}

function isInlineOptionWithValue(option: string): boolean {
  return (
    option.startsWith("-e") ||
    option.startsWith("-f") ||
    option.startsWith("-g") ||
    option.startsWith("-t") ||
    option.startsWith("-T")
  );
}

function parseRgSearchFromCommand(command: string): ParsedRgSearch | null {
  const tokens = tokenizeShell(unwrapShellWrapper(command));
  const segments = splitPipeline(tokens);

  for (const segment of segments) {
    if (segment[0] !== "rg") {
      continue;
    }

    const positional: string[] = [];
    let allRemainingArePositional = false;

    for (let index = 1; index < segment.length; index += 1) {
      const token = segment[index];
      if (token == null) {
        continue;
      }

      if (!allRemainingArePositional && token === "--") {
        allRemainingArePositional = true;
        continue;
      }

      if (!allRemainingArePositional && token.startsWith("--")) {
        if (token.includes("=")) {
          continue;
        }
        if (optionConsumesNextValue(token)) {
          index += 1;
        }
        continue;
      }

      if (!allRemainingArePositional && token.startsWith("-")) {
        if (isInlineOptionWithValue(token)) {
          continue;
        }
        if (optionConsumesNextValue(token)) {
          index += 1;
        }
        continue;
      }

      positional.push(token);
    }

    if (positional.length === 0) {
      return {
        query: null,
        path: null,
      };
    }

    if (positional.length === 1) {
      return {
        query: positional[0] ?? null,
        path: null,
      };
    }

    return {
      query: positional[0] ?? null,
      path: positional[positional.length - 1] ?? null,
    };
  }

  return null;
}

function hasRgCommand(command: string): boolean {
  const tokens = tokenizeShell(unwrapShellWrapper(command));
  const segments = splitPipeline(tokens);
  return segments.some((segment) => segment[0] === "rg");
}

function formatLineRangeRead(
  parsedRead: ParsedLineRangeRead,
): { text: string; tooltip?: string } {
  const summarizedPath = summarizePath(parsedRead.path);
  const lineLabel =
    parsedRead.startLine === parsedRead.endLine
      ? `line ${parsedRead.startLine}`
      : `lines ${parsedRead.startLine}-${parsedRead.endLine}`;
  const text = `Read ${lineLabel} from ${summarizedPath.shortPath}`;
  if (summarizedPath.fullPath == null) {
    return { text };
  }
  return {
    text,
    tooltip: `Read ${lineLabel} from ${summarizedPath.fullPath}`,
  };
}

function formatSearchText(
  query: string | null,
  path: string | null,
): { text: string; tooltip?: string } {
  const quotedQuery = query != null ? `"${shortenText(query)}"` : null;
  if (quotedQuery != null && path != null) {
    const summarizedPath = summarizePath(path);
    const text = `Searched ${quotedQuery} in ${summarizedPath.shortPath}`;
    if (summarizedPath.fullPath == null) {
      return { text };
    }
    return {
      text,
      tooltip: `Searched ${quotedQuery} in ${summarizedPath.fullPath}`,
    };
  }
  if (quotedQuery != null) {
    return { text: `Searched ${quotedQuery}` };
  }
  if (path != null) {
    const summarizedPath = summarizePath(path);
    const text = `Searched in ${summarizedPath.shortPath}`;
    if (summarizedPath.fullPath == null) {
      return { text };
    }
    return {
      text,
      tooltip: `Searched in ${summarizedPath.fullPath}`,
    };
  }
  return { text: "Searched" };
}

function withRawCommand(
  presentation: Omit<CommandActionPresentation, "rawCommand">,
  rawCommand: string | null,
): CommandActionPresentation {
  if (rawCommand == null || rawCommand === presentation.text) {
    return presentation;
  }
  return {
    ...presentation,
    rawCommand,
  };
}

function summarizePath(path: string): {
  shortPath: string;
  fullPath?: string;
} {
  const trimmedPath = path.trim();
  if (trimmedPath.length === 0) {
    return { shortPath: path };
  }

  const segments = trimmedPath.split(/[\\/]/).filter((segment) => segment.length > 0);
  const tail = segments[segments.length - 1];
  if (tail == null || tail.length === 0 || tail === trimmedPath) {
    return { shortPath: trimmedPath };
  }

  return {
    shortPath: tail,
    fullPath: trimmedPath,
  };
}

function splitCombinedCommands(command: string): string[] {
  const segments: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaping = false;

  const pushCurrent = (): void => {
    const trimmed = current.trim();
    if (trimmed.length > 0) {
      segments.push(trimmed);
    }
    current = "";
  };

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index] ?? "";
    const nextChar = command[index + 1] ?? "";

    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (char === "\\" && !inSingleQuote) {
      current += char;
      escaping = true;
      continue;
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      current += char;
      continue;
    }

    if (char === "\"" && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      current += char;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote) {
      if (char === ";" || char === "\n") {
        pushCurrent();
        continue;
      }

      if ((char === "&" && nextChar === "&") || (char === "|" && nextChar === "|")) {
        pushCurrent();
        index += 1;
        continue;
      }
    }

    current += char;
  }

  pushCurrent();
  return segments;
}

function dedupeConsecutiveSegments(
  segments: CommandActionPresentation[],
): CommandActionPresentation[] {
  const deduped: CommandActionPresentation[] = [];
  for (const segment of segments) {
    const previous = deduped[deduped.length - 1];
    if (
      previous != null &&
      previous.iconKey === segment.iconKey &&
      previous.text === segment.text &&
      previous.tooltip === segment.tooltip
    ) {
      continue;
    }
    deduped.push(segment);
  }
  return deduped;
}

export function describeCommandAction(
  action: CommandActionForUi,
): CommandActionPresentation {
  const actionPath = normalizeText(action.path);
  const actionQuery = normalizeText(action.query);
  const rawCommand = normalizeText(action.command);

  if (rawCommand != null) {
    const parsedRangeRead = parseReadRangeFromCommand(rawCommand, actionPath);
    if (parsedRangeRead != null) {
      return withRawCommand(
        {
          iconKey: "read",
          ...formatLineRangeRead(parsedRangeRead),
        },
        rawCommand,
      );
    }
  }

  if ((action.type === "search" || (rawCommand != null && hasRgCommand(rawCommand)))) {
    const parsedSearch =
      rawCommand != null ? parseRgSearchFromCommand(rawCommand) : null;
    const query = actionQuery ?? parsedSearch?.query ?? null;
    const path = actionPath ?? parsedSearch?.path ?? null;
    return withRawCommand(
      {
        iconKey: "search",
        ...formatSearchText(query, path),
      },
      rawCommand,
    );
  }

  if (action.type === "listFiles") {
    const summarizedPath = actionPath != null ? summarizePath(actionPath) : null;
    const text =
      summarizedPath != null
        ? `Listed files in ${summarizedPath.shortPath}`
        : "Listed files";
    return withRawCommand(
      {
        iconKey: "listFiles",
        text,
        ...(summarizedPath?.fullPath != null
          ? { tooltip: `Listed files in ${summarizedPath.fullPath}` }
          : {}),
      },
      rawCommand,
    );
  }

  if (action.type === "read" || action.type === "readFile") {
    const target = actionPath ?? normalizeText(action.name);
    const summarizedPath = target != null ? summarizePath(target) : null;
    const text =
      summarizedPath != null ? `Read ${summarizedPath.shortPath}` : "Read file";
    return withRawCommand(
      {
        iconKey: action.type === "readFile" ? "readFile" : "read",
        text,
        ...(summarizedPath?.fullPath != null
          ? { tooltip: `Read ${summarizedPath.fullPath}` }
          : {}),
      },
      rawCommand,
    );
  }

  if (action.type === "write" || action.type === "writeFile") {
    const target = actionPath ?? normalizeText(action.name);
    const summarizedPath = target != null ? summarizePath(target) : null;
    const text =
      summarizedPath != null ? `Wrote ${summarizedPath.shortPath}` : "Wrote file";
    return withRawCommand(
      {
        iconKey: action.type === "writeFile" ? "writeFile" : "write",
        text,
        ...(summarizedPath?.fullPath != null
          ? { tooltip: `Wrote ${summarizedPath.fullPath}` }
          : {}),
      },
      rawCommand,
    );
  }

  const fallbackText =
    normalizeText(action.name) ?? rawCommand ?? actionPath ?? action.type;
  return {
    iconKey: "unknown",
    text: fallbackText,
  };
}

export function summarizeCommandForHeader(
  command: string,
  commandActions?: CommandActionForUi[] | undefined,
): CommandActionPresentation[] {
  const normalizedActions =
    commandActions?.map((action) => describeCommandAction(action)) ?? [];
  const cleanedActions = dedupeConsecutiveSegments(normalizedActions);

  const unwrapped = unwrapShellWrapper(command);
  const combinedSegments = splitCombinedCommands(unwrapped);
  const cleanedCombinedSegments = dedupeConsecutiveSegments(
    combinedSegments.map((segment) =>
      describeCommandAction({
        type: "unknown",
        command: segment,
      }),
    ),
  );

  if (cleanedCombinedSegments.length > 1) {
    return cleanedCombinedSegments;
  }
  if (cleanedActions.length > 0) {
    return cleanedActions;
  }
  if (cleanedCombinedSegments.length > 0) {
    return cleanedCombinedSegments;
  }

  return [
    {
      iconKey: "unknown",
      text: command.trim().length > 0 ? command.trim() : "Command",
    },
  ];
}

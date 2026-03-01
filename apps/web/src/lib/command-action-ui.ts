import type { UnifiedItem } from "@farfield/unified-surface";

type CommandExecutionItem = Extract<UnifiedItem, { type: "commandExecution" }>;
type CommandAction = NonNullable<CommandExecutionItem["commandActions"]>[number];

type IconKey = "terminal" | "search" | "listFiles" | "write" | "read";

export interface CommandHeaderSegment {
  iconKey: IconKey;
  text: string;
  tooltip?: string;
}

const MAX_SEGMENT_LENGTH = 72;

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxLength = MAX_SEGMENT_LENGTH): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1)}…`;
}

function displayPath(path: string): string {
  const cleaned = path.trim();
  if (!cleaned) {
    return "(path)";
  }
  return cleaned;
}

function segmentFromAction(action: CommandAction): CommandHeaderSegment | null {
  const actionType = action.type;
  const path = action.path?.trim() ?? "";
  const query = action.query?.trim() ?? "";
  const name = action.name?.trim() ?? "";
  const command = action.command?.trim() ?? "";

  if (actionType === "search") {
    const sourceText = query || command || name;
    if (!sourceText) {
      return { iconKey: "search", text: "search" };
    }
    return {
      iconKey: "search",
      text: truncate(sourceText),
      tooltip: sourceText
    };
  }

  if (actionType === "listFiles") {
    if (!path) {
      return { iconKey: "listFiles", text: "list files" };
    }
    return {
      iconKey: "listFiles",
      text: truncate(displayPath(path)),
      tooltip: displayPath(path)
    };
  }

  if (actionType === "read" || actionType === "readFile") {
    const sourceText = path || name || command;
    if (!sourceText) {
      return { iconKey: "read", text: "read file" };
    }
    return {
      iconKey: "read",
      text: truncate(sourceText),
      tooltip: sourceText
    };
  }

  if (actionType === "write" || actionType === "writeFile") {
    const sourceText = path || name || command;
    if (!sourceText) {
      return { iconKey: "write", text: "write file" };
    }
    return {
      iconKey: "write",
      text: truncate(sourceText),
      tooltip: sourceText
    };
  }

  const genericText = command || name || path || query;
  if (!genericText) {
    return null;
  }
  return {
    iconKey: "terminal",
    text: truncate(genericText),
    tooltip: genericText
  };
}

export function summarizeCommandForHeader(
  command: string,
  commandActions: CommandExecutionItem["commandActions"]
): CommandHeaderSegment[] {
  const segments = (commandActions ?? [])
    .map((action) => segmentFromAction(action))
    .filter((segment): segment is CommandHeaderSegment => segment !== null);

  if (segments.length > 0) {
    return segments;
  }

  const normalizedCommand = compactWhitespace(command);
  if (!normalizedCommand) {
    return [{ iconKey: "terminal", text: "(command)" }];
  }

  return [
    {
      iconKey: "terminal",
      text: truncate(normalizedCommand),
      tooltip: normalizedCommand
    }
  ];
}

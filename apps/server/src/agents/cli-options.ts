import { z } from "zod";
import type { AgentId } from "./types.js";

const AgentIdSchema = z.enum(["codex", "opencode"]);

export const ALL_AGENT_IDS: AgentId[] = ["codex", "opencode"];
export const DEFAULT_AGENT_IDS: AgentId[] = ["codex"];

export interface ServerCliOptions {
  agentIds: AgentId[];
  showHelp: boolean;
}

function formatAllowedAgentIds(): string {
  return ALL_AGENT_IDS.join(", ");
}

function parseAgentsArg(raw: string): AgentId[] {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error("Missing value for --agents");
  }

  const tokens = trimmed
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  if (tokens.length === 0) {
    throw new Error("Missing value for --agents");
  }

  const expanded: AgentId[] = [];
  for (const token of tokens) {
    if (token === "all") {
      expanded.push(...ALL_AGENT_IDS);
      continue;
    }

    const parsed = AgentIdSchema.safeParse(token);
    if (!parsed.success) {
      throw new Error(
        `Unknown agent id "${token}". Allowed values: ${formatAllowedAgentIds()}, all`,
      );
    }
    expanded.push(parsed.data);
  }

  const deduped: AgentId[] = [];
  const seen = new Set<AgentId>();
  for (const id of expanded) {
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    deduped.push(id);
  }

  if (deduped.length === 0) {
    throw new Error(
      `No valid agent ids were provided. Allowed values: ${formatAllowedAgentIds()}, all`,
    );
  }

  return deduped;
}

export function formatServerHelpText(): string {
  return [
    "Farfield server",
    "",
    "Usage: farfield-server [--agents=<ids>]",
    "",
    "Flags:",
    "  --agents=<ids>   Comma-separated agent ids. Allowed: codex, opencode, all",
    "  --help           Show this help message",
  ].join("\n");
}

export function parseServerCliOptions(argv: string[]): ServerCliOptions {
  let parsedAgents: AgentId[] | null = null;
  let showHelp = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) {
      continue;
    }

    if (arg === "--") {
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      showHelp = true;
      continue;
    }

    if (arg.startsWith("--agents=")) {
      const value = arg.slice("--agents=".length);
      parsedAgents = parseAgentsArg(value);
      continue;
    }

    if (arg === "--agents") {
      const nextArg = argv[index + 1];
      if (!nextArg || nextArg.startsWith("--")) {
        throw new Error("Missing value for --agents");
      }
      parsedAgents = parseAgentsArg(nextArg);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return {
    agentIds: parsedAgents ?? [...DEFAULT_AGENT_IDS],
    showHelp,
  };
}

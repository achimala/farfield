export type AgentKind = "codex" | "opencode";

const threadAgentMap = new Map<string, AgentKind>();

export function registerThreadAgent(threadId: string, kind: AgentKind): void {
  threadAgentMap.set(threadId, kind);
}

export function resolveAgentKind(threadId: string): AgentKind {
  return threadAgentMap.get(threadId) ?? "codex";
}

export function isOpenCodeThread(threadId: string): boolean {
  return threadAgentMap.get(threadId) === "opencode";
}

export function listRegisteredThreads(): Array<{ threadId: string; agentKind: AgentKind }> {
  return Array.from(threadAgentMap.entries()).map(([threadId, agentKind]) => ({
    threadId,
    agentKind
  }));
}

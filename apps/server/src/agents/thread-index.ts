import type { AgentId } from "./types.js";

export class ThreadIndex {
  private readonly agentIdsByThreadId = new Map<string, Set<AgentId>>();

  public register(threadId: string, agentId: AgentId): void {
    const existing = this.agentIdsByThreadId.get(threadId);
    if (existing) {
      existing.add(agentId);
      return;
    }

    this.agentIdsByThreadId.set(threadId, new Set([agentId]));
  }

  public resolve(threadId: string): AgentId | null {
    const candidates = this.agentIdsByThreadId.get(threadId);
    if (!candidates || candidates.size !== 1) {
      return null;
    }

    const [resolved] = Array.from(candidates);
    return resolved ?? null;
  }

  public providers(threadId: string): AgentId[] {
    return Array.from(this.agentIdsByThreadId.get(threadId) ?? []);
  }

  public list(): Array<{ threadId: string; agentIds: AgentId[] }> {
    return Array.from(this.agentIdsByThreadId.entries()).map(
      ([threadId, agentIds]) => ({
        threadId,
        agentIds: Array.from(agentIds),
      }),
    );
  }
}

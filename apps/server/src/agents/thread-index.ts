import type { AgentId } from "./types.js";

export class ThreadIndex {
  private readonly agentIdByThreadId = new Map<string, AgentId>();

  public register(threadId: string, agentId: AgentId): void {
    this.agentIdByThreadId.set(threadId, agentId);
  }

  public resolve(threadId: string): AgentId | null {
    return this.agentIdByThreadId.get(threadId) ?? null;
  }

  public list(): Array<{ threadId: string; agentId: AgentId }> {
    return Array.from(this.agentIdByThreadId.entries()).map(
      ([threadId, agentId]) => ({
        threadId,
        agentId,
      }),
    );
  }
}

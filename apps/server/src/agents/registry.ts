import type { AgentAdapter, AgentCapabilities, AgentId } from "./types.js";

export class AgentRegistry {
  private readonly ordered: AgentAdapter[];
  private readonly byId: Map<AgentId, AgentAdapter>;

  public constructor(adapters: AgentAdapter[]) {
    this.ordered = [];
    this.byId = new Map();

    for (const adapter of adapters) {
      if (this.byId.has(adapter.id)) {
        throw new Error(`Duplicate agent adapter id: ${adapter.id}`);
      }
      this.byId.set(adapter.id, adapter);
      this.ordered.push(adapter);
    }
  }

  public listAdapters(): AgentAdapter[] {
    return [...this.ordered];
  }

  public getAdapter(id: AgentId): AgentAdapter | null {
    return this.byId.get(id) ?? null;
  }

  public listEnabled(): AgentAdapter[] {
    return this.ordered.filter((adapter) => adapter.isEnabled());
  }

  public resolveDefaultAgentId(): AgentId | null {
    const firstEnabled = this.listEnabled()[0];
    return firstEnabled ? firstEnabled.id : null;
  }

  public resolveFirstWithCapability(
    capability: keyof AgentCapabilities,
  ): AgentAdapter | null {
    for (const adapter of this.listEnabled()) {
      if (!adapter.isConnected()) {
        continue;
      }
      if (adapter.capabilities[capability]) {
        return adapter;
      }
    }
    return null;
  }

  public async startAll(): Promise<void> {
    for (const adapter of this.ordered) {
      await adapter.start();
    }
  }

  public async stopAll(): Promise<void> {
    const reversed = [...this.ordered].reverse();
    for (const adapter of reversed) {
      await adapter.stop();
    }
  }
}

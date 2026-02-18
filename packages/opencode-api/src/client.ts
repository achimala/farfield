import {
  createOpencode,
  createOpencodeClient,
  type OpencodeClient,
  type OpencodeClientConfig
} from "@opencode-ai/sdk";

export interface OpenCodeClientOptions {
  hostname?: string;
  port?: number;
  url?: string;
}

export class OpenCodeConnection {
  private client: OpencodeClient | null = null;
  private server: { url: string; close(): void } | null = null;
  private readonly options: OpenCodeClientOptions;

  public constructor(options: OpenCodeClientOptions = {}) {
    this.options = options;
  }

  public async start(): Promise<void> {
    if (this.options.url) {
      this.client = createOpencodeClient({
        baseUrl: this.options.url
      } as OpencodeClientConfig);
      return;
    }

    const result = await createOpencode({
      hostname: this.options.hostname ?? "127.0.0.1",
      port: this.options.port ?? 0,
      timeout: 30_000
    });

    this.client = result.client;
    this.server = result.server;
  }

  public async stop(): Promise<void> {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    this.client = null;
  }

  public getClient(): OpencodeClient {
    if (!this.client) {
      throw new Error("OpenCode connection not started");
    }
    return this.client;
  }

  public getUrl(): string | null {
    return this.server?.url ?? this.options.url ?? null;
  }

  public isConnected(): boolean {
    return this.client !== null;
  }
}

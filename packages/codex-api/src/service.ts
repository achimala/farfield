import {
  type TurnStartParams,
  type CollaborationMode,
  parseUserInputResponsePayload,
  type UserInputResponsePayload
} from "@farfield/protocol";
import type { DesktopIpcClient } from "./ipc-client.js";

export interface SendMessageInput {
  threadId: string;
  ownerClientId: string;
  text: string;
  cwd?: string;
  isSteering?: boolean;
  turnStartTemplate?: TurnStartParams | null;
  model?: string | null;
  effort?: string | null;
  collaborationMode?: CollaborationMode | null;
}

export interface SetModeInput {
  threadId: string;
  ownerClientId: string;
  collaborationMode: CollaborationMode;
}

export interface SubmitUserInputInput {
  threadId: string;
  ownerClientId: string;
  requestId: number;
  response: UserInputResponsePayload;
}

export interface InterruptInput {
  threadId: string;
  ownerClientId: string;
}

export class CodexMonitorService {
  private readonly ipcClient: DesktopIpcClient;

  public constructor(ipcClient: DesktopIpcClient) {
    this.ipcClient = ipcClient;
  }

  public async sendMessage(input: SendMessageInput): Promise<void> {
    const text = input.text.trim();
    if (!text) {
      throw new Error("Message text is required");
    }

    const template = input.turnStartTemplate;

    const turnStartParams: TurnStartParams = template
      ? {
          ...template,
          threadId: input.threadId,
          input: [{ type: "text" as const, text }],
          cwd: input.cwd ?? template.cwd,
          attachments: Array.isArray(template.attachments) ? template.attachments : []
        }
      : {
          threadId: input.threadId,
          input: [{ type: "text" as const, text }],
          ...(input.cwd ? { cwd: input.cwd } : {}),
          attachments: []
        };

    if (Object.prototype.hasOwnProperty.call(input, "model")) {
      turnStartParams.model = input.model ?? null;
    }

    if (Object.prototype.hasOwnProperty.call(input, "effort")) {
      turnStartParams.effort = input.effort ?? null;
    }

    if (Object.prototype.hasOwnProperty.call(input, "collaborationMode")) {
      turnStartParams.collaborationMode = input.collaborationMode ?? null;
    }

    await this.ipcClient.sendRequestAndWait(
      "thread-follower-start-turn",
      {
        conversationId: input.threadId,
        turnStartParams,
        isSteering: Boolean(input.isSteering)
      },
      {
        targetClientId: input.ownerClientId,
        version: 1
      }
    );
  }

  public async setCollaborationMode(input: SetModeInput): Promise<void> {
    await this.ipcClient.sendRequestAndWait(
      "thread-follower-set-collaboration-mode",
      {
        conversationId: input.threadId,
        collaborationMode: input.collaborationMode
      },
      {
        targetClientId: input.ownerClientId,
        version: 1
      }
    );
  }

  public async submitUserInput(input: SubmitUserInputInput): Promise<void> {
    const payload = parseUserInputResponsePayload(input.response);

    await this.ipcClient.sendRequestAndWait(
      "thread-follower-submit-user-input",
      {
        conversationId: input.threadId,
        requestId: input.requestId,
        response: payload
      },
      {
        targetClientId: input.ownerClientId,
        version: 1
      }
    );
  }

  public async interrupt(input: InterruptInput): Promise<void> {
    await this.ipcClient.sendRequestAndWait(
      "thread-follower-interrupt-turn",
      {
        conversationId: input.threadId
      },
      {
        targetClientId: input.ownerClientId,
        version: 1
      }
    );
  }
}

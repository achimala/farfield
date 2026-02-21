import { describe, expect, it } from "vitest";
import {
  parseBody,
  ReplayBodySchema,
  SendMessageBodySchema,
  StartThreadBodySchema,
  SetModeBodySchema,
  SubmitUserInputBodySchema
} from "../src/http-schemas.js";

describe("server request schemas", () => {
  it("accepts valid send message body", () => {
    const parsed = parseBody(SendMessageBodySchema, {
      text: "hello",
      isSteering: false
    });

    expect(parsed.text).toBe("hello");
  });

  it("rejects unknown fields", () => {
    expect(() =>
      parseBody(SendMessageBodySchema, {
        text: "hello",
        extra: true
      })
    ).toThrowError(/Unrecognized key/);
  });

  it("validates set mode body", () => {
    const parsed = parseBody(SetModeBodySchema, {
      collaborationMode: {
        mode: "plan",
        settings: {
          model: "gpt-5.3-codex",
          reasoning_effort: "high",
          developer_instructions: "x"
        }
      }
    });

    expect(parsed.collaborationMode.mode).toBe("plan");
  });

  it("rejects invalid request id type", () => {
    expect(() =>
      parseBody(SubmitUserInputBodySchema, {
        requestId: true,
        response: {}
      })
    ).toThrowError(/Invalid input/);
  });

  it("validates replay body", () => {
    const parsed = parseBody(ReplayBodySchema, {
      entryId: "abc",
      waitForResponse: true
    });

    expect(parsed.waitForResponse).toBe(true);
  });

  it("validates start thread body with agentId", () => {
    const parsed = parseBody(StartThreadBodySchema, {
      agentId: "opencode",
      cwd: "/tmp/workspace"
    });

    expect(parsed.agentId).toBe("opencode");
  });

  it("rejects deprecated agentKind field", () => {
    expect(() =>
      parseBody(StartThreadBodySchema, {
        agentKind: "opencode"
      })
    ).toThrowError(/Unrecognized key/);
  });
});

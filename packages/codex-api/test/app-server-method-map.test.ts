import { describe, expect, it } from "vitest";
import {
  APP_SERVER_CLIENT_NOTIFICATION_METHODS,
  APP_SERVER_CLIENT_REQUEST_METHODS,
  APP_SERVER_SERVER_NOTIFICATION_METHODS,
  APP_SERVER_SERVER_REQUEST_METHODS
} from "@farfield/protocol";
import {
  CODEX_CLIENT_NOTIFICATION_METHOD_MAP,
  CODEX_CLIENT_REQUEST_METHOD_MAP,
  CODEX_SERVER_NOTIFICATION_METHOD_MAP,
  CODEX_SERVER_REQUEST_METHOD_MAP
} from "../src/app-server-method-map.js";

describe("codex app-server method map", () => {
  it("covers every generated method list exactly", () => {
    expect(Object.keys(CODEX_CLIENT_REQUEST_METHOD_MAP).sort()).toEqual(
      [...APP_SERVER_CLIENT_REQUEST_METHODS].sort()
    );
    expect(Object.keys(CODEX_CLIENT_NOTIFICATION_METHOD_MAP).sort()).toEqual(
      [...APP_SERVER_CLIENT_NOTIFICATION_METHODS].sort()
    );
    expect(Object.keys(CODEX_SERVER_REQUEST_METHOD_MAP).sort()).toEqual(
      [...APP_SERVER_SERVER_REQUEST_METHODS].sort()
    );
    expect(Object.keys(CODEX_SERVER_NOTIFICATION_METHOD_MAP).sort()).toEqual(
      [...APP_SERVER_SERVER_NOTIFICATION_METHODS].sort()
    );
  });

  it("maps representative client request methods to unified command kinds", () => {
    expect(CODEX_CLIENT_REQUEST_METHOD_MAP["thread/list"]).toEqual({
      status: "exposed",
      commandKind: "listThreads"
    });
    expect(CODEX_CLIENT_REQUEST_METHOD_MAP["thread/start"]).toEqual({
      status: "exposed",
      commandKind: "createThread"
    });
    expect(CODEX_CLIENT_REQUEST_METHOD_MAP["turn/start"]).toEqual({
      status: "exposed",
      commandKind: "sendMessage"
    });
    expect(CODEX_CLIENT_REQUEST_METHOD_MAP["turn/interrupt"]).toEqual({
      status: "exposed",
      commandKind: "interrupt"
    });
    expect(CODEX_CLIENT_REQUEST_METHOD_MAP["collaborationMode/list"]).toEqual({
      status: "exposed",
      commandKind: "listCollaborationModes"
    });
    expect(CODEX_CLIENT_REQUEST_METHOD_MAP["skills/list"]).toEqual({
      status: "internal"
    });
  });

  it("maps representative server request and notification methods to unified events", () => {
    expect(CODEX_SERVER_REQUEST_METHOD_MAP["item/tool/requestUserInput"]).toEqual({
      status: "exposed",
      eventKind: "userInputRequested"
    });
    expect(CODEX_SERVER_NOTIFICATION_METHOD_MAP.error).toEqual({
      status: "exposed",
      eventKind: "error"
    });
    expect(CODEX_SERVER_NOTIFICATION_METHOD_MAP["turn/completed"]).toEqual({
      status: "exposed",
      eventKind: "threadUpdated"
    });
    expect(CODEX_SERVER_NOTIFICATION_METHOD_MAP["fuzzyFileSearch/sessionUpdated"]).toEqual({
      status: "internal"
    });
  });
});

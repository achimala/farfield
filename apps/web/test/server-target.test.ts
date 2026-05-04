import { beforeEach, describe, expect, it } from "vitest";
import {
  clearStoredServerTarget,
  readStoredServerTarget,
  saveServerBaseUrl,
} from "../src/lib/server-target";

describe("server target storage", () => {
  beforeEach(() => {
    clearStoredServerTarget();
  });

  it("stores an optional auth token with the server target", () => {
    saveServerBaseUrl("https://farfield.example.com", " secret ");

    expect(readStoredServerTarget()).toEqual({
      version: 1,
      baseUrl: "https://farfield.example.com",
      authToken: "secret",
    });
  });

  it("omits empty auth tokens", () => {
    saveServerBaseUrl("https://farfield.example.com", "   ");

    expect(readStoredServerTarget()).toEqual({
      version: 1,
      baseUrl: "https://farfield.example.com",
    });
  });
});

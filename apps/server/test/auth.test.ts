import { describe, expect, it } from "vitest";
import type { IncomingMessage } from "node:http";
import {
  isHttpRequestAuthorized,
  isSocketAuthorized,
  requestToken,
  resolveFarfieldAuthConfig,
} from "../src/auth.js";

function requestWithHeaders(
  headers: IncomingMessage["headers"],
): IncomingMessage {
  return { headers } as IncomingMessage;
}

describe("farfield auth", () => {
  it("is disabled when FARFIELD_AUTH_TOKEN is not set", () => {
    const config = resolveFarfieldAuthConfig({});

    expect(config.token).toBe("");
    expect(config.corsOrigin).toBe("*");
    expect(isHttpRequestAuthorized(requestWithHeaders({}), config)).toBe(true);
  });

  it("uses farfield.app as the default cors origin when auth is enabled", () => {
    const config = resolveFarfieldAuthConfig({
      FARFIELD_AUTH_TOKEN: "secret",
    });

    expect(config.corsOrigin).toBe("https://farfield.app");
  });

  it("uses configured cors origin when provided", () => {
    const config = resolveFarfieldAuthConfig({
      FARFIELD_AUTH_TOKEN: "secret",
      FARFIELD_CORS_ORIGIN: "https://phone.example.com",
    });

    expect(config.corsOrigin).toBe("https://phone.example.com");
  });

  it("authorizes bearer tokens", () => {
    const config = resolveFarfieldAuthConfig({
      FARFIELD_AUTH_TOKEN: "secret",
    });

    expect(
      isHttpRequestAuthorized(
        requestWithHeaders({ authorization: "Bearer secret" }),
        config,
      ),
    ).toBe(true);
  });

  it("authorizes x-farfield-token headers", () => {
    const config = resolveFarfieldAuthConfig({
      FARFIELD_AUTH_TOKEN: "secret",
    });

    expect(
      isHttpRequestAuthorized(
        requestWithHeaders({ "x-farfield-token": "secret" }),
        config,
      ),
    ).toBe(true);
  });

  it("rejects missing or incorrect tokens", () => {
    const config = resolveFarfieldAuthConfig({
      FARFIELD_AUTH_TOKEN: "secret",
    });

    expect(isHttpRequestAuthorized(requestWithHeaders({}), config)).toBe(false);
    expect(
      isHttpRequestAuthorized(
        requestWithHeaders({ authorization: "Bearer wrong" }),
        config,
      ),
    ).toBe(false);
  });

  it("extracts x-farfield-token before bearer auth", () => {
    expect(
      requestToken(
        requestWithHeaders({
          authorization: "Bearer wrong",
          "x-farfield-token": "secret",
        }),
      ),
    ).toBe("secret");
  });

  it("authorizes socket auth payloads", () => {
    const config = resolveFarfieldAuthConfig({
      FARFIELD_AUTH_TOKEN: "secret",
    });

    expect(isSocketAuthorized({ token: "secret" }, {}, config)).toBe(true);
    expect(isSocketAuthorized({ token: "wrong" }, {}, config)).toBe(false);
  });
});

import type { IncomingHttpHeaders, IncomingMessage } from "node:http";

export interface FarfieldAuthConfig {
  token: string;
  corsOrigin: string;
}

export function resolveFarfieldAuthConfig(
  env: NodeJS.ProcessEnv = process.env,
): FarfieldAuthConfig {
  const token = env["FARFIELD_AUTH_TOKEN"]?.trim() ?? "";
  const corsOrigin =
    env["FARFIELD_CORS_ORIGIN"]?.trim() ??
    (token.length > 0 ? "https://farfield.app" : "*");

  return {
    token,
    corsOrigin,
  };
}

function readBearerToken(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const [scheme, token] = value.split(/\s+/, 2);
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return null;
  }
  return token;
}

function tokenMatches(value: unknown, expectedToken: string): boolean {
  return (
    typeof value === "string" &&
    expectedToken.length > 0 &&
    value === expectedToken
  );
}

function directHeaderToken(headers: IncomingHttpHeaders): string | null {
  const directHeader = headers["x-farfield-token"];
  if (Array.isArray(directHeader)) {
    return directHeader.find((value) => value.length > 0) ?? null;
  }
  return directHeader ?? null;
}

export function requestToken(req: IncomingMessage): string | null {
  return directHeaderToken(req.headers) ?? readBearerToken(req.headers.authorization);
}

export function isHttpRequestAuthorized(
  req: IncomingMessage,
  config: FarfieldAuthConfig,
): boolean {
  if (config.token.length === 0) {
    return true;
  }
  return tokenMatches(requestToken(req), config.token);
}

export function isSocketAuthorized(
  auth: unknown,
  headers: IncomingHttpHeaders,
  config: FarfieldAuthConfig,
): boolean {
  if (config.token.length === 0) {
    return true;
  }

  if (auth && typeof auth === "object" && "token" in auth) {
    const token = (auth as { token?: unknown }).token;
    if (tokenMatches(token, config.token)) {
      return true;
    }
  }

  return (
    tokenMatches(directHeaderToken(headers), config.token) ||
    tokenMatches(readBearerToken(headers.authorization), config.token)
  );
}

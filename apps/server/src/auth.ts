import { createPublicKey, createVerify, type JsonWebKey, type KeyObject } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { z } from "zod";

const BooleanStringSchema = z.enum(["0", "1", "false", "true"]);

const RawSecurityEnvSchema = z
  .object({
    FARFIELD_AUTH_MODE: z.enum(["none", "cloudflare-access"]).optional(),
    FARFIELD_CORS_ORIGIN: z.string().min(1).optional(),
    FARFIELD_DEBUG_API_ENABLED: BooleanStringSchema.optional(),
    CF_ACCESS_TEAM_DOMAIN: z.string().min(1).optional(),
    CF_ACCESS_AUDIENCE: z.string().min(1).optional()
  })
  .strict();

const AccessJwtHeaderSchema = z
  .object({
    alg: z.literal("RS256"),
    kid: z.string().min(1),
    typ: z.string().optional()
  })
  .strict();

const AccessJwtPayloadSchema = z
  .object({
    aud: z.array(z.string().min(1)).min(1),
    exp: z.number().int().positive(),
    iat: z.number().int().positive(),
    nbf: z.number().int().positive().optional(),
    iss: z.string().min(1),
    sub: z.string().min(1),
    email: z.string().email().optional(),
    type: z.string().min(1).optional(),
    identity_nonce: z.string().min(1).optional(),
    country: z.string().min(1).optional(),
    policy_id: z.string().min(1).optional()
  })
  .strict();

const AccessCertKeySchema = z
  .object({
    kid: z.string().min(1),
    kty: z.literal("RSA"),
    alg: z.literal("RS256"),
    n: z.string().min(1),
    e: z.string().min(1),
    use: z.string().optional()
  })
  .strict();

const AccessCertResponseSchema = z
  .object({
    keys: z.array(AccessCertKeySchema).min(1),
    public_cert: z.union([z.string(), z.record(z.unknown())]).optional(),
    public_certs: z.array(z.union([z.string(), z.record(z.unknown())])).optional()
  })
  .strict();

type AuthMode = "none" | "cloudflare-access";

interface SecurityConfig {
  authMode: AuthMode;
  corsOrigin: string;
  debugApiEnabled: boolean;
  cloudflare: {
    teamDomain: string;
    audience: string;
    issuer: string;
    certsUrl: string;
  } | null;
}

export interface AuthIdentity {
  subject: string;
  email: string | null;
}

type AuthResult =
  | { ok: true; identity: AuthIdentity | null }
  | { ok: false; status: number; error: string };

function parseBooleanFlag(value: z.infer<typeof BooleanStringSchema> | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  return value === "1" || value === "true";
}

function normalizeTeamDomain(value: string): string {
  const normalized = value.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (normalized.length === 0) {
    throw new Error("CF_ACCESS_TEAM_DOMAIN cannot be empty");
  }
  return normalized;
}

function getSingleHeader(value: string | string[] | undefined): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    const first = value[0];
    return first ?? null;
  }
  return null;
}

function decodeJwtPart<T extends z.ZodTypeAny>(encoded: string, schema: T, label: string): z.infer<T> {
  let decodedText = "";
  try {
    decodedText = Buffer.from(encoded, "base64url").toString("utf8");
  } catch {
    throw new Error(`Invalid ${label} encoding`);
  }

  let parsedValue: ReturnType<typeof JSON.parse>;
  try {
    parsedValue = JSON.parse(decodedText);
  } catch {
    throw new Error(`Invalid ${label} JSON`);
  }

  return schema.parse(parsedValue);
}

function parseToken(token: string): {
  encodedHeader: string;
  encodedPayload: string;
  encodedSignature: string;
  header: z.infer<typeof AccessJwtHeaderSchema>;
  payload: z.infer<typeof AccessJwtPayloadSchema>;
} {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid access token format");
  }

  const encodedHeader = parts[0];
  const encodedPayload = parts[1];
  const encodedSignature = parts[2];

  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    throw new Error("Invalid access token segments");
  }

  const header = decodeJwtPart(encodedHeader, AccessJwtHeaderSchema, "JWT header");
  const payload = decodeJwtPart(encodedPayload, AccessJwtPayloadSchema, "JWT payload");

  return { encodedHeader, encodedPayload, encodedSignature, header, payload };
}

function assertClaimSet(
  payload: z.infer<typeof AccessJwtPayloadSchema>,
  expectedAudience: string,
  expectedIssuer: string
): void {
  const normalizedExpectedIssuer = expectedIssuer.replace(/\/+$/, "");
  const normalizedTokenIssuer = payload.iss.replace(/\/+$/, "");
  if (normalizedTokenIssuer !== normalizedExpectedIssuer) {
    throw new Error("Access token issuer mismatch");
  }

  if (!payload.aud.includes(expectedAudience)) {
    throw new Error("Access token audience mismatch");
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp <= now) {
    throw new Error("Access token has expired");
  }
}

class AccessCertificateStore {
  private readonly certsUrl: string;
  private cacheExpiresAt = 0;
  private readonly keyById = new Map<string, KeyObject>();

  constructor(certsUrl: string) {
    this.certsUrl = certsUrl;
  }

  async getKey(kid: string): Promise<KeyObject> {
    const now = Date.now();
    if (this.keyById.has(kid) && now < this.cacheExpiresAt) {
      const cached = this.keyById.get(kid);
      if (!cached) {
        throw new Error("Access certificate cache read failed");
      }
      return cached;
    }

    await this.refresh();
    const refreshed = this.keyById.get(kid);
    if (!refreshed) {
      throw new Error("Access certificate key id not found");
    }
    return refreshed;
  }

  private async refresh(): Promise<void> {
    const response = await fetch(this.certsUrl, {
      method: "GET",
      headers: {
        "User-Agent": "farfield-access-auth/1.0"
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch access certs: HTTP ${response.status}`);
    }

    const body: ReturnType<typeof JSON.parse> = JSON.parse(await response.text());
    const parsed = AccessCertResponseSchema.parse(body);

    this.keyById.clear();
    for (const key of parsed.keys) {
      const jwk: JsonWebKey = {
        kty: key.kty,
        kid: key.kid,
        alg: key.alg,
        n: key.n,
        e: key.e,
        ...(key.use ? { use: key.use } : {})
      };
      const publicKey = createPublicKey({ key: jwk, format: "jwk" });
      this.keyById.set(key.kid, publicKey);
    }

    this.cacheExpiresAt = Date.now() + 60_000;
  }
}

class CloudflareAccessVerifier {
  private readonly audience: string;
  private readonly issuer: string;
  private readonly certStore: AccessCertificateStore;

  constructor(config: { audience: string; issuer: string; certsUrl: string }) {
    this.audience = config.audience;
    this.issuer = config.issuer;
    this.certStore = new AccessCertificateStore(config.certsUrl);
  }

  async verify(assertion: string): Promise<AuthIdentity> {
    const token = parseToken(assertion);
    assertClaimSet(token.payload, this.audience, this.issuer);

    const key = await this.certStore.getKey(token.header.kid);
    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${token.encodedHeader}.${token.encodedPayload}`);
    verifier.end();

    const signature = Buffer.from(token.encodedSignature, "base64url");
    const valid = verifier.verify(key, signature);
    if (!valid) {
      throw new Error("Access token signature is invalid");
    }

    return {
      subject: token.payload.sub,
      email: token.payload.email ?? null
    };
  }
}

function loadSecurityConfig(): SecurityConfig {
  const raw = RawSecurityEnvSchema.parse({
    FARFIELD_AUTH_MODE: process.env["FARFIELD_AUTH_MODE"],
    FARFIELD_CORS_ORIGIN: process.env["FARFIELD_CORS_ORIGIN"],
    FARFIELD_DEBUG_API_ENABLED: process.env["FARFIELD_DEBUG_API_ENABLED"],
    CF_ACCESS_TEAM_DOMAIN: process.env["CF_ACCESS_TEAM_DOMAIN"],
    CF_ACCESS_AUDIENCE: process.env["CF_ACCESS_AUDIENCE"]
  });

  const authMode: AuthMode = raw.FARFIELD_AUTH_MODE ?? "none";
  const debugFromEnv = parseBooleanFlag(raw.FARFIELD_DEBUG_API_ENABLED);

  if (authMode === "none") {
    return {
      authMode,
      corsOrigin: raw.FARFIELD_CORS_ORIGIN ?? "*",
      debugApiEnabled: debugFromEnv ?? true,
      cloudflare: null
    };
  }

  if (!raw.CF_ACCESS_TEAM_DOMAIN) {
    throw new Error("CF_ACCESS_TEAM_DOMAIN is required when FARFIELD_AUTH_MODE=cloudflare-access");
  }
  if (!raw.CF_ACCESS_AUDIENCE) {
    throw new Error("CF_ACCESS_AUDIENCE is required when FARFIELD_AUTH_MODE=cloudflare-access");
  }
  if (!raw.FARFIELD_CORS_ORIGIN) {
    throw new Error("FARFIELD_CORS_ORIGIN is required when FARFIELD_AUTH_MODE=cloudflare-access");
  }

  const teamDomain = normalizeTeamDomain(raw.CF_ACCESS_TEAM_DOMAIN);
  return {
    authMode,
    corsOrigin: raw.FARFIELD_CORS_ORIGIN,
    debugApiEnabled: debugFromEnv ?? false,
    cloudflare: {
      teamDomain,
      audience: raw.CF_ACCESS_AUDIENCE,
      issuer: `https://${teamDomain}/`,
      certsUrl: `https://${teamDomain}/cdn-cgi/access/certs`
    }
  };
}

export interface SecurityPolicy {
  readonly authMode: AuthMode;
  readonly corsOrigin: string;
  readonly debugApiEnabled: boolean;
  readonly cloudflareTeamDomain: string | null;
  authenticate(req: IncomingMessage): Promise<AuthResult>;
}

class NoAuthPolicy implements SecurityPolicy {
  readonly authMode = "none" as const;
  readonly corsOrigin: string;
  readonly debugApiEnabled: boolean;
  readonly cloudflareTeamDomain: string | null = null;

  constructor(config: SecurityConfig) {
    this.corsOrigin = config.corsOrigin;
    this.debugApiEnabled = config.debugApiEnabled;
  }

  async authenticate(): Promise<AuthResult> {
    return { ok: true, identity: null };
  }
}

class CloudflareAccessPolicy implements SecurityPolicy {
  readonly authMode = "cloudflare-access" as const;
  readonly corsOrigin: string;
  readonly debugApiEnabled: boolean;
  readonly cloudflareTeamDomain: string;
  private readonly verifier: CloudflareAccessVerifier;

  constructor(config: SecurityConfig) {
    if (!config.cloudflare) {
      throw new Error("Cloudflare configuration is unavailable");
    }
    this.corsOrigin = config.corsOrigin;
    this.debugApiEnabled = config.debugApiEnabled;
    this.cloudflareTeamDomain = config.cloudflare.teamDomain;
    this.verifier = new CloudflareAccessVerifier({
      audience: config.cloudflare.audience,
      issuer: config.cloudflare.issuer,
      certsUrl: config.cloudflare.certsUrl
    });
  }

  async authenticate(req: IncomingMessage): Promise<AuthResult> {
    const assertion = getSingleHeader(req.headers["cf-access-jwt-assertion"]);
    if (!assertion || assertion.trim().length === 0) {
      return {
        ok: false,
        status: 401,
        error: "Missing Cloudflare Access assertion header"
      };
    }

    try {
      const identity = await this.verifier.verify(assertion);
      return {
        ok: true,
        identity
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Access token verification failed";
      return {
        ok: false,
        status: 401,
        error: message
      };
    }
  }
}

export function createSecurityPolicy(): SecurityPolicy {
  const config = loadSecurityConfig();
  if (config.authMode === "none") {
    return new NoAuthPolicy(config);
  }
  return new CloudflareAccessPolicy(config);
}

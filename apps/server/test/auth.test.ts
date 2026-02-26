import { IncomingMessage } from "node:http";
import { Socket } from "node:net";
import {
  createSign,
  generateKeyPairSync,
  type JsonWebKey,
  type KeyObject
} from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSecurityPolicy } from "../src/auth.js";

const ORIGINAL_ENV = { ...process.env };

function restoreEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key];
    }
  }

  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    process.env[key] = value;
  }
}

function clearSecurityEnv(): void {
  delete process.env["FARFIELD_AUTH_MODE"];
  delete process.env["FARFIELD_CORS_ORIGIN"];
  delete process.env["FARFIELD_DEBUG_API_ENABLED"];
  delete process.env["CF_ACCESS_TEAM_DOMAIN"];
  delete process.env["CF_ACCESS_AUDIENCE"];
}

function configureCloudflareSecurityEnv(): void {
  process.env["FARFIELD_AUTH_MODE"] = "cloudflare-access";
  process.env["FARFIELD_CORS_ORIGIN"] = "https://farfield.example.com";
  process.env["CF_ACCESS_TEAM_DOMAIN"] = "example.cloudflareaccess.com";
  process.env["CF_ACCESS_AUDIENCE"] = "test-audience";
}

interface TestJwtMaterial {
  token: string;
  certResponseJson: string;
}

function buildSignedAccessToken(
  options: {
    kid: string;
    publicKey: KeyObject;
    privateKey: KeyObject;
    includeExtendedClaims: boolean;
    includeObjectCertFields: boolean;
    expiresOffsetSeconds?: number;
    issuer?: string;
    audience?: string;
    signingPrivateKey?: KeyObject;
  }
): TestJwtMaterial {
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: "RS256",
    kid: options.kid,
    typ: "JWT"
  };
  const payload = {
    aud: [options.audience ?? "test-audience"],
    exp: now + (options.expiresOffsetSeconds ?? 3600),
    iat: now - 60,
    iss: options.issuer ?? "https://example.cloudflareaccess.com",
    sub: "user-123",
    email: "user@example.com",
    ...(options.includeExtendedClaims
      ? {
        nbf: now - 60,
        type: "app",
        identity_nonce: "nonce-123",
        country: "DE",
        policy_id: "policy-abc"
      }
      : {})
  };

  const encodedHeader = Buffer.from(JSON.stringify(header), "utf8").toString("base64url");
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const input = `${encodedHeader}.${encodedPayload}`;

  const signer = createSign("RSA-SHA256");
  signer.update(input);
  signer.end();
  const signature = signer.sign(options.signingPrivateKey ?? options.privateKey).toString("base64url");

  const exportedPublicJwk = options.publicKey.export({ format: "jwk" }) as JsonWebKey;
  const certBody = {
    keys: [
      {
        kid: options.kid,
        kty: "RSA",
        alg: "RS256",
        n: exportedPublicJwk.n,
        e: exportedPublicJwk.e,
        use: "sig"
      }
    ],
    ...(options.includeObjectCertFields
      ? {
        public_cert: { kty: "RSA", kid: options.kid },
        public_certs: [{ kty: "RSA", kid: `${options.kid}-1` }]
      }
      : {})
  };

  return {
    token: `${input}.${signature}`,
    certResponseJson: JSON.stringify(certBody)
  };
}

function buildRequestWithAssertion(assertion: string): IncomingMessage {
  const req = new IncomingMessage(new Socket());
  req.headers["cf-access-jwt-assertion"] = assertion;
  return req;
}

function stubAccessCertFetch(certResponseJson: string): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(certResponseJson, {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      }))
  );
}

afterEach(() => {
  restoreEnv();
  vi.unstubAllGlobals();
});

describe("createSecurityPolicy", () => {
  it("uses local defaults when auth mode is none", () => {
    clearSecurityEnv();

    const policy = createSecurityPolicy();
    expect(policy.authMode).toBe("none");
    expect(policy.corsOrigin).toBe("*");
    expect(policy.debugApiEnabled).toBe(true);
  });

  it("requires Cloudflare env values when cloudflare-access mode is enabled", () => {
    clearSecurityEnv();
    process.env["FARFIELD_AUTH_MODE"] = "cloudflare-access";
    process.env["FARFIELD_CORS_ORIGIN"] = "https://farfield.example.com";

    expect(() => createSecurityPolicy()).toThrowError(
      "CF_ACCESS_TEAM_DOMAIN is required when FARFIELD_AUTH_MODE=cloudflare-access"
    );
  });

  it("rejects missing access assertion header in cloudflare-access mode", async () => {
    clearSecurityEnv();
    configureCloudflareSecurityEnv();

    const policy = createSecurityPolicy();
    const req = new IncomingMessage(new Socket());

    const result = await policy.authenticate(req);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.status).toBe(401);
    expect(result.error).toBe("Missing Cloudflare Access assertion header");
  });

  it("accepts Cloudflare JWTs with extended claims", async () => {
    clearSecurityEnv();
    configureCloudflareSecurityEnv();

    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const authFixture = buildSignedAccessToken({
      kid: "kid-extended",
      publicKey,
      privateKey,
      includeExtendedClaims: true,
      includeObjectCertFields: false
    });
    stubAccessCertFetch(authFixture.certResponseJson);

    const policy = createSecurityPolicy();
    const result = await policy.authenticate(buildRequestWithAssertion(authFixture.token));
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.identity.subject).toBe("user-123");
    expect(result.identity.email).toBe("user@example.com");
  });

  it("accepts cert responses that include object public_cert and public_certs fields", async () => {
    clearSecurityEnv();
    configureCloudflareSecurityEnv();

    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const authFixture = buildSignedAccessToken({
      kid: "kid-cert-objects",
      publicKey,
      privateKey,
      includeExtendedClaims: false,
      includeObjectCertFields: true
    });
    stubAccessCertFetch(authFixture.certResponseJson);

    const policy = createSecurityPolicy();
    const result = await policy.authenticate(buildRequestWithAssertion(authFixture.token));
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.identity.subject).toBe("user-123");
  });

  it("rejects expired access assertions", async () => {
    clearSecurityEnv();
    configureCloudflareSecurityEnv();

    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const authFixture = buildSignedAccessToken({
      kid: "kid-expired",
      publicKey,
      privateKey,
      includeExtendedClaims: false,
      includeObjectCertFields: false,
      expiresOffsetSeconds: -120
    });
    stubAccessCertFetch(authFixture.certResponseJson);

    const policy = createSecurityPolicy();
    const result = await policy.authenticate(buildRequestWithAssertion(authFixture.token));
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.status).toBe(401);
    expect(result.error).toBe("Access token has expired");
  });

  it("rejects assertions with invalid signatures", async () => {
    clearSecurityEnv();
    configureCloudflareSecurityEnv();

    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const { privateKey: wrongPrivateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const authFixture = buildSignedAccessToken({
      kid: "kid-bad-signature",
      publicKey,
      privateKey,
      signingPrivateKey: wrongPrivateKey,
      includeExtendedClaims: false,
      includeObjectCertFields: false
    });
    stubAccessCertFetch(authFixture.certResponseJson);

    const policy = createSecurityPolicy();
    const result = await policy.authenticate(buildRequestWithAssertion(authFixture.token));
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.status).toBe(401);
    expect(result.error).toBe("Access token signature is invalid");
  });

  it("rejects assertions with issuer and audience mismatches", async () => {
    clearSecurityEnv();
    configureCloudflareSecurityEnv();

    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const issuerMismatchFixture = buildSignedAccessToken({
      kid: "kid-issuer-mismatch",
      publicKey,
      privateKey,
      issuer: "https://other.cloudflareaccess.com",
      includeExtendedClaims: false,
      includeObjectCertFields: false
    });
    stubAccessCertFetch(issuerMismatchFixture.certResponseJson);

    const policy = createSecurityPolicy();
    const issuerMismatchResult = await policy.authenticate(
      buildRequestWithAssertion(issuerMismatchFixture.token)
    );
    expect(issuerMismatchResult.ok).toBe(false);
    if (issuerMismatchResult.ok) {
      return;
    }
    expect(issuerMismatchResult.status).toBe(401);
    expect(issuerMismatchResult.error).toBe("Access token issuer mismatch");

    const audienceMismatchFixture = buildSignedAccessToken({
      kid: "kid-audience-mismatch",
      publicKey,
      privateKey,
      audience: "other-audience",
      includeExtendedClaims: false,
      includeObjectCertFields: false
    });
    stubAccessCertFetch(audienceMismatchFixture.certResponseJson);

    const audienceMismatchResult = await policy.authenticate(
      buildRequestWithAssertion(audienceMismatchFixture.token)
    );
    expect(audienceMismatchResult.ok).toBe(false);
    if (audienceMismatchResult.ok) {
      return;
    }
    expect(audienceMismatchResult.status).toBe(401);
    expect(audienceMismatchResult.error).toBe("Access token audience mismatch");
  });

  it("rejects malformed non-JWT assertions", async () => {
    clearSecurityEnv();
    configureCloudflareSecurityEnv();

    const policy = createSecurityPolicy();
    const result = await policy.authenticate(buildRequestWithAssertion("not-a-jwt"));
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.status).toBe(401);
    expect(result.error).toBe("Invalid access token format");
  });
});

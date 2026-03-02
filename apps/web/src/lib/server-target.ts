import { z } from "zod";

const STORAGE_KEY = "farfield.server-target.v1";
const DEFAULT_SERVER_PORT = 4311;

const ServerProtocolSchema = z.enum(["http:", "https:"]);

const ServerBaseUrlSchema = z
  .string()
  .trim()
  .url()
  .superRefine((value, ctx) => {
    const url = new URL(value);

    if (!ServerProtocolSchema.safeParse(url.protocol).success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Server URL must start with http:// or https://",
      });
    }

    if (url.pathname !== "/" && url.pathname.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Server URL cannot include a path",
      });
    }

    if (url.search.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Server URL cannot include a query string",
      });
    }

    if (url.hash.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Server URL cannot include a hash fragment",
      });
    }
  })
  .transform((value) => {
    const url = new URL(value);
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  });

const StoredServerTargetSchema = z
  .object({
    version: z.literal(1),
    baseUrl: ServerBaseUrlSchema,
  })
  .strict();

const StoredServerTargetTextSchema = z.string().transform((raw, ctx) => {
  try {
    return JSON.parse(raw);
  } catch {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Saved server target is not valid JSON",
    });
    return z.NEVER;
  }
});

const ApiPathSchema = z
  .string()
  .min(1, "API path is required")
  .regex(/^\//, "API path must start with '/'");

export type StoredServerTarget = z.infer<typeof StoredServerTargetSchema>;

function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export function getDefaultServerBaseUrl(): string {
  if (typeof window === "undefined") {
    return `http://127.0.0.1:${String(DEFAULT_SERVER_PORT)}`;
  }

  const hostname = window.location.hostname;

  if (isLocalHost(hostname)) {
    return `http://127.0.0.1:${String(DEFAULT_SERVER_PORT)}`;
  }

  return window.location.origin;
}

export function readStoredServerTarget(): StoredServerTarget | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === null) {
    return null;
  }

  const parsedJson = StoredServerTargetTextSchema.parse(raw);
  return StoredServerTargetSchema.parse(parsedJson);
}

export function parseServerBaseUrl(value: string): string {
  return ServerBaseUrlSchema.parse(value);
}

export function saveServerBaseUrl(value: string): StoredServerTarget {
  const parsedBaseUrl = parseServerBaseUrl(value);
  const next: StoredServerTarget = {
    version: 1,
    baseUrl: parsedBaseUrl,
  };

  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  return next;
}

export function clearStoredServerTarget(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(STORAGE_KEY);
}

export function resolveServerBaseUrl(): string {
  const stored = readStoredServerTarget();
  if (stored) {
    return stored.baseUrl;
  }
  return getDefaultServerBaseUrl();
}

export function buildServerUrl(path: string, baseUrlOverride?: string): string {
  const parsedPath = ApiPathSchema.parse(path);
  const baseUrl =
    typeof baseUrlOverride === "string"
      ? parseServerBaseUrl(baseUrlOverride)
      : resolveServerBaseUrl();
  return new URL(parsedPath, `${baseUrl}/`).toString();
}

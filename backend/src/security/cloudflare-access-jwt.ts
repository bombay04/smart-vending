import { createPublicKey, verify as verifySignature, type KeyObject } from "node:crypto";

export interface CloudflareAccessClaims {
  type: "app";
  aud: string[];
  exp: number;
  iat: number;
  nbf?: number;
  iss: string;
  common_name: string;
  sub: "";
}

interface JwtHeader {
  alg: "RS256";
  kid: string;
  typ?: string;
}

export interface JwksProvider {
  getKey(kid: string): Promise<KeyObject | null>;
}

export interface CloudflareAccessVerifierConfig {
  issuer: string;
  audience: string;
  serviceTokenClientId: string;
  jwksProvider: JwksProvider;
  now?: () => number;
  clockSkewSeconds?: number;
}

export class AccessJwtVerificationError extends Error {
  constructor() {
    super("Cloudflare Access JWT verification failed.");
    this.name = "AccessJwtVerificationError";
  }
}

function fail(): never {
  throw new AccessJwtVerificationError();
}

function decodeJsonSegment(value: string): unknown {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) fail();
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
  } catch {
    fail();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readHeader(value: unknown): JwtHeader {
  if (!isRecord(value)) fail();
  if (
    value.alg !== "RS256" ||
    typeof value.kid !== "string" ||
    value.kid.length === 0 ||
    (value.typ !== undefined && value.typ !== "JWT")
  ) {
    fail();
  }
  return {
    alg: "RS256",
    kid: value.kid,
    ...(value.typ === "JWT" ? { typ: "JWT" } : {}),
  };
}

function readClaims(
  value: unknown,
  config: CloudflareAccessVerifierConfig,
): CloudflareAccessClaims {
  if (!isRecord(value)) fail();
  const audience =
    Array.isArray(value.aud) && value.aud.every((entry) => typeof entry === "string")
      ? value.aud
      : typeof value.aud === "string"
        ? [value.aud]
        : [];
  if (
    value.type !== "app" ||
    !audience.includes(config.audience) ||
    value.iss !== config.issuer ||
    value.common_name !== config.serviceTokenClientId ||
    value.sub !== "" ||
    typeof value.exp !== "number" ||
    !Number.isSafeInteger(value.exp) ||
    typeof value.iat !== "number" ||
    !Number.isSafeInteger(value.iat) ||
    (value.nbf !== undefined && (typeof value.nbf !== "number" || !Number.isSafeInteger(value.nbf)))
  ) {
    fail();
  }

  const now = (config.now ?? (() => Math.floor(Date.now() / 1000)))();
  const clockSkewSeconds = config.clockSkewSeconds ?? 30;
  if (
    value.exp <= now ||
    value.iat > now + clockSkewSeconds ||
    (typeof value.nbf === "number" && value.nbf > now + clockSkewSeconds)
  ) {
    fail();
  }

  return {
    type: "app",
    aud: audience,
    exp: value.exp,
    iat: value.iat,
    ...(typeof value.nbf === "number" ? { nbf: value.nbf } : {}),
    iss: config.issuer,
    common_name: config.serviceTokenClientId,
    sub: "",
  };
}

export function createCloudflareAccessJwtVerifier(
  config: CloudflareAccessVerifierConfig,
): (token: string) => Promise<CloudflareAccessClaims> {
  return async (token: string) => {
    const parts = token.split(".");
    if (parts.length !== 3 || parts.some((part) => part.length === 0)) fail();
    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const header = readHeader(decodeJsonSegment(encodedHeader));
    const claimsValue = decodeJsonSegment(encodedPayload);
    if (!/^[A-Za-z0-9_-]+$/.test(encodedSignature)) fail();

    const key = await config.jwksProvider.getKey(header.kid);
    if (key === null) fail();
    const valid = verifySignature(
      "RSA-SHA256",
      Buffer.from(`${encodedHeader}.${encodedPayload}`, "ascii"),
      key,
      Buffer.from(encodedSignature, "base64url"),
    );
    if (!valid) fail();
    return readClaims(claimsValue, config);
  };
}

interface CloudflareJwk extends JsonWebKey {
  kid?: string;
  use?: string;
  alg?: string;
  [key: string]: unknown;
}

interface CloudflareJwksDocument {
  keys?: CloudflareJwk[];
}

function normalizeTeamDomain(teamDomain: string): string {
  let url: URL;
  try {
    url = new URL(teamDomain);
  } catch {
    throw new Error("CLOUDFLARE_ACCESS_TEAM_DOMAIN must be a valid HTTPS origin.");
  }
  if (
    url.protocol !== "https:" ||
    !url.hostname.endsWith(".cloudflareaccess.com") ||
    url.username ||
    url.password ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search ||
    url.hash
  ) {
    throw new Error("CLOUDFLARE_ACCESS_TEAM_DOMAIN must be a cloudflareaccess.com HTTPS origin.");
  }
  return url.origin;
}

export function createRemoteJwksProvider(
  teamDomain: string,
  options: {
    fetchImplementation?: typeof fetch;
    cacheTtlMs?: number;
    requestTimeoutMs?: number;
    now?: () => number;
  } = {},
): JwksProvider {
  const issuer = normalizeTeamDomain(teamDomain);
  const certsUrl = `${issuer}/cdn-cgi/access/certs`;
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const cacheTtlMs = options.cacheTtlMs ?? 60 * 60 * 1000;
  const requestTimeoutMs = options.requestTimeoutMs ?? 5_000;
  const now = options.now ?? Date.now;
  let expiresAt = 0;
  let keys = new Map<string, KeyObject>();

  const refresh = async (): Promise<void> => {
    const response = await fetchImplementation(certsUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
    if (!response.ok) throw new Error("Unable to load Cloudflare Access signing keys.");
    const rawDocument = await response.text();
    if (Buffer.byteLength(rawDocument, "utf8") > 1024 * 1024) {
      throw new Error("Cloudflare Access signing key response is too large.");
    }
    let document: CloudflareJwksDocument;
    try {
      document = JSON.parse(rawDocument) as CloudflareJwksDocument;
    } catch {
      throw new Error("Cloudflare Access signing key response is invalid.");
    }
    if (!Array.isArray(document.keys)) {
      throw new Error("Cloudflare Access signing key response is invalid.");
    }
    const nextKeys = new Map<string, KeyObject>();
    for (const jwk of document.keys) {
      if (
        jwk.kty !== "RSA" ||
        typeof jwk.kid !== "string" ||
        jwk.kid.length === 0 ||
        (jwk.use !== undefined && jwk.use !== "sig") ||
        (jwk.alg !== undefined && jwk.alg !== "RS256")
      ) {
        continue;
      }
      try {
        nextKeys.set(jwk.kid, createPublicKey({ key: jwk, format: "jwk" }));
      } catch {
        // Ignore malformed individual keys. An empty usable set fails closed.
      }
    }
    if (nextKeys.size === 0) {
      throw new Error("Cloudflare Access returned no usable signing keys.");
    }
    keys = nextKeys;
    expiresAt = now() + cacheTtlMs;
  };

  return {
    async getKey(kid: string) {
      let refreshed = false;
      if (now() >= expiresAt) {
        await refresh();
        refreshed = true;
      }
      let key = keys.get(kid);
      if (key === undefined && !refreshed) {
        await refresh();
        key = keys.get(kid);
      }
      return key ?? null;
    },
  };
}

export function normalizeCloudflareTeamDomain(teamDomain: string): string {
  return normalizeTeamDomain(teamDomain);
}

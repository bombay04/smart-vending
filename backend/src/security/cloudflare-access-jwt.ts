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

export type AccessJwtFailureCategory =
  | "jwks_fetch_or_key_resolution_failure"
  | "invalid_jwt_signature_or_algorithm"
  | "issuer_mismatch"
  | "audience_mismatch"
  | "service_token_client_id_mismatch"
  | "token_type_or_subject_mismatch"
  | "timestamp_validation_failure"
  | "invalid_verifier_configuration";

export class AccessJwtVerificationError extends Error {
  constructor(readonly category: AccessJwtFailureCategory) {
    super("Cloudflare Access JWT verification failed.");
    this.name = "AccessJwtVerificationError";
  }
}

function fail(category: AccessJwtFailureCategory): never {
  throw new AccessJwtVerificationError(category);
}

function decodeJsonSegment(value: string): unknown {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) fail("invalid_jwt_signature_or_algorithm");
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
  } catch {
    fail("invalid_jwt_signature_or_algorithm");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readHeader(value: unknown): JwtHeader {
  if (!isRecord(value)) fail("invalid_jwt_signature_or_algorithm");
  if (
    value.alg !== "RS256" ||
    typeof value.kid !== "string" ||
    value.kid.length === 0 ||
    (value.typ !== undefined && value.typ !== "JWT")
  ) {
    fail("invalid_jwt_signature_or_algorithm");
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
  if (!isRecord(value)) fail("invalid_jwt_signature_or_algorithm");
  const audience =
    Array.isArray(value.aud) && value.aud.every((entry) => typeof entry === "string")
      ? value.aud
      : typeof value.aud === "string"
        ? [value.aud]
        : [];
  if (value.iss !== config.issuer) fail("issuer_mismatch");
  if (!audience.includes(config.audience)) fail("audience_mismatch");
  if (value.common_name !== config.serviceTokenClientId) {
    fail("service_token_client_id_mismatch");
  }
  if (value.type !== "app" || value.sub !== "") fail("token_type_or_subject_mismatch");
  if (
    typeof value.exp !== "number" ||
    !Number.isSafeInteger(value.exp) ||
    typeof value.iat !== "number" ||
    !Number.isSafeInteger(value.iat) ||
    (value.nbf !== undefined && (typeof value.nbf !== "number" || !Number.isSafeInteger(value.nbf)))
  ) {
    fail("timestamp_validation_failure");
  }

  const now = (config.now ?? (() => Math.floor(Date.now() / 1000)))();
  const clockSkewSeconds = config.clockSkewSeconds ?? 30;
  if (
    value.exp <= now ||
    value.iat > now + clockSkewSeconds ||
    (typeof value.nbf === "number" && value.nbf > now + clockSkewSeconds)
  ) {
    fail("timestamp_validation_failure");
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
  if (!config.issuer || !config.audience || !config.serviceTokenClientId) {
    fail("invalid_verifier_configuration");
  }
  return async (token: string) => {
    const parts = token.split(".");
    if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
      fail("invalid_jwt_signature_or_algorithm");
    }
    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const header = readHeader(decodeJsonSegment(encodedHeader));
    const claimsValue = decodeJsonSegment(encodedPayload);
    if (!/^[A-Za-z0-9_-]+$/.test(encodedSignature)) {
      fail("invalid_jwt_signature_or_algorithm");
    }

    let key: KeyObject | null;
    try {
      key = await config.jwksProvider.getKey(header.kid);
    } catch {
      fail("jwks_fetch_or_key_resolution_failure");
    }
    if (key === null) fail("jwks_fetch_or_key_resolution_failure");
    let valid: boolean;
    try {
      valid = verifySignature(
        "RSA-SHA256",
        Buffer.from(`${encodedHeader}.${encodedPayload}`, "ascii"),
        key,
        Buffer.from(encodedSignature, "base64url"),
      );
    } catch {
      fail("invalid_jwt_signature_or_algorithm");
    }
    if (!valid) fail("invalid_jwt_signature_or_algorithm");
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

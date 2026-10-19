import type { NextFunction, Request, RequestHandler, Response } from "express";
import {
  AccessJwtVerificationError,
  createCloudflareAccessJwtVerifier,
  createRemoteJwksProvider,
  normalizeCloudflareTeamDomain,
  type AccessJwtFailureCategory,
  type CloudflareAccessClaims,
} from "./cloudflare-access-jwt";

export const DEFAULT_PI_API_HOSTNAME = "pi-api.smartvendingpt.com";

const PI_ROUTE_ALLOWLIST: ReadonlyArray<{
  method: "GET" | "POST";
  path: RegExp;
}> = [
  { method: "GET", path: /^\/api\/v1\/slots$/ },
  { method: "POST", path: /^\/api\/v1\/transactions\/payments$/ },
  {
    method: "GET",
    path: /^\/api\/v1\/transactions\/[1-9]\d*\/payment-status$/,
  },
  {
    method: "POST",
    path: /^\/api\/v1\/transactions\/[1-9]\d*\/cancel$/,
  },
  { method: "GET", path: /^\/api\/v1\/kiosk-sessions\/current$/ },
  {
    method: "POST",
    path: /^\/api\/v1\/kiosk-sessions\/[1-9]\d*\/cancel$/,
  },
  { method: "POST", path: /^\/api\/v1\/employees\/auth\/face$/ },
  { method: "POST", path: /^\/api\/v1\/restocks\/mock$/ },
  { method: "POST", path: /^\/api\/v1\/restocks\/unlock-grant$/ },
  {
    method: "POST",
    path: /^\/api\/v1\/employees\/face-registration\/complete$/,
  },
  {
    method: "POST",
    path: /^\/api\/v1\/kiosk-sessions\/[1-9]\d*\/draft-delete-result$/,
  },
  {
    method: "POST",
    path: /^\/api\/v1\/kiosk-sessions\/[1-9]\d*\/offboarding-complete$/,
  },
];

export function isAllowedPiApiRequest(method: string, path: string): boolean {
  const routeAllowed = PI_ROUTE_ALLOWLIST.some(
    (entry) => entry.method === method.toUpperCase() && entry.path.test(path),
  );
  if (!routeAllowed) return false;
  return path
    .split("/")
    .filter((segment) => /^\d+$/.test(segment))
    .every((segment) => BigInt(segment) <= 2_147_483_647n);
}

function requestHost(request: Request): string | null {
  const rawHost = request.headers.host;
  if (
    typeof rawHost !== "string" ||
    rawHost.length === 0 ||
    rawHost.includes(",") ||
    /[\s/@\\]/.test(rawHost)
  ) {
    return null;
  }
  try {
    return new URL(`http://${rawHost}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

type AccessJwtVerifier = (token: string) => Promise<CloudflareAccessClaims>;

export function createPiOriginGuard(options: {
  piApiHostname: string;
  verifyAccessJwt: AccessJwtVerifier;
  logVerificationFailure?: (category: AccessJwtFailureCategory) => void;
}): RequestHandler {
  const piApiHostname = options.piApiHostname.toLowerCase();
  const logVerificationFailure =
    options.logVerificationFailure ??
    ((category: AccessJwtFailureCategory) => {
      console.warn(`[pi-access-jwt] verification_failed category=${category}`);
    });
  return async (request: Request, response: Response, next: NextFunction) => {
    // Deliberately ignore X-Forwarded-Host and all other forwarding headers.
    if (requestHost(request) !== piApiHostname) {
      next();
      return;
    }

    if (!isAllowedPiApiRequest(request.method, request.path)) {
      response.status(404).json({ error: "Route is not available on the Pi API hostname." });
      return;
    }

    const token = request.headers["cf-access-jwt-assertion"];
    if (typeof token !== "string" || token.length === 0) {
      response.status(401).json({ error: "Machine authentication is required." });
      return;
    }

    try {
      await options.verifyAccessJwt(token);
      next();
    } catch (error) {
      const category =
        error instanceof AccessJwtVerificationError
          ? error.category
          : "jwks_fetch_or_key_resolution_failure";
      logVerificationFailure(category);
      response.status(401).json({ error: "Machine authentication failed." });
    }
  };
}

export function createPiOriginGuardFromEnvironment(): RequestHandler {
  const piApiHostname = process.env.PI_API_HOSTNAME?.trim() || DEFAULT_PI_API_HOSTNAME;
  let verifier: AccessJwtVerifier | null = null;

  const loadVerifier = (): AccessJwtVerifier => {
    if (verifier !== null) return verifier;
    const teamDomainValue = process.env.CLOUDFLARE_ACCESS_TEAM_DOMAIN?.trim();
    const audience = process.env.CLOUDFLARE_ACCESS_AUDIENCE?.trim();
    const serviceTokenClientId = process.env.CLOUDFLARE_ACCESS_SERVICE_TOKEN_CLIENT_ID?.trim();
    if (!teamDomainValue || !audience || !serviceTokenClientId) {
      throw new AccessJwtVerificationError("invalid_verifier_configuration");
    }
    try {
      const issuer = normalizeCloudflareTeamDomain(teamDomainValue);
      verifier = createCloudflareAccessJwtVerifier({
        issuer,
        audience,
        serviceTokenClientId,
        jwksProvider: createRemoteJwksProvider(issuer),
      });
    } catch {
      throw new AccessJwtVerificationError("invalid_verifier_configuration");
    }
    return verifier;
  };

  return createPiOriginGuard({
    piApiHostname,
    verifyAccessJwt: (token) => loadVerifier()(token),
  });
}

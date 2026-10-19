import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import { AccessJwtVerificationError, type AccessJwtFailureCategory } from "./cloudflare-access-jwt";
import { createPiOriginGuard, isAllowedPiApiRequest } from "./pi-origin-guard";

const validClaims = {
  type: "app" as const,
  aud: ["pi-audience"],
  exp: 2_000_000_000,
  iat: 1_900_000_000,
  iss: "https://smart-vending.cloudflareaccess.com",
  common_name: "pi-service-token.access",
  sub: "" as const,
};

async function request(options: {
  host: string;
  method: string;
  path: string;
  token?: string;
  forwardedHost?: string;
  verifier?: (token: string) => Promise<typeof validClaims>;
  logVerificationFailure?: (category: AccessJwtFailureCategory) => void;
}): Promise<Response> {
  const app = express();
  app.use(
    createPiOriginGuard({
      piApiHostname: "pi-api.smartvendingpt.com",
      verifyAccessJwt:
        options.verifier ??
        (async (value) => {
          if (value !== "valid-token") throw new Error("invalid");
          return validClaims;
        }),
      logVerificationFailure: options.logVerificationFailure ?? (() => undefined),
    }),
  );
  app.use((_request, response) => {
    response.status(200).json({ reached: true });
  });

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  try {
    const { port } = server.address() as AddressInfo;
    const headers: Record<string, string> = { Host: options.host };
    if (options.token !== undefined) {
      headers["Cf-Access-Jwt-Assertion"] = options.token;
    }
    if (options.forwardedHost !== undefined) {
      headers["X-Forwarded-Host"] = options.forwardedHost;
    }
    return await new Promise<Response>((resolve, reject) => {
      const outgoing = httpRequest({
        hostname: "127.0.0.1",
        port,
        path: options.path,
        method: options.method,
        headers,
      });
      outgoing.once("error", reject);
      outgoing.once("response", (incoming) => {
        const chunks: Buffer[] = [];
        incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
        incoming.once("error", reject);
        incoming.once("end", () => {
          resolve(
            new Response(Buffer.concat(chunks), {
              status: incoming.statusCode,
              headers: incoming.headers as Record<string, string>,
            }),
          );
        });
      });
      outgoing.end();
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test("origin allowlist exactly matches the relay cloud surface", () => {
  const allowed = [
    ["GET", "/api/v1/slots"],
    ["POST", "/api/v1/transactions/payments"],
    ["GET", "/api/v1/transactions/1/payment-status"],
    ["POST", "/api/v1/transactions/1/cancel"],
    ["GET", "/api/v1/kiosk-sessions/current"],
    ["POST", "/api/v1/kiosk-sessions/1/cancel"],
    ["POST", "/api/v1/employees/auth/face"],
    ["POST", "/api/v1/restocks/mock"],
    ["POST", "/api/v1/restocks/unlock-grant"],
    ["POST", "/api/v1/employees/face-registration/complete"],
    ["POST", "/api/v1/kiosk-sessions/1/draft-delete-result"],
    ["POST", "/api/v1/kiosk-sessions/1/offboarding-complete"],
  ];
  for (const [method, path] of allowed) {
    assert.equal(isAllowedPiApiRequest(method, path), true, `${method} ${path}`);
  }

  const denied = [
    ["POST", "/api/v1/slots"],
    ["GET", "/api/v1/products"],
    ["GET", "/api/v1/admin/slots"],
    ["POST", "/api/v1/employees"],
    ["POST", "/api/v1/transactions/omise/webhook"],
    ["POST", "/unlock"],
    ["GET", "/api/v1/transactions/0/payment-status"],
    ["GET", "/api/v1/transactions/2147483648/payment-status"],
    ["POST", "/api/v1/kiosk-sessions/-1/cancel"],
    ["GET", "/api/v1/slots/"],
  ];
  for (const [method, path] of denied) {
    assert.equal(isAllowedPiApiRequest(method, path), false, `${method} ${path}`);
  }
});

test("Pi hostname requires a verified JWT on allowed routes", async () => {
  assert.equal(
    (
      await request({
        host: "pi-api.smartvendingpt.com",
        method: "GET",
        path: "/api/v1/slots",
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await request({
        host: "pi-api.smartvendingpt.com",
        method: "GET",
        path: "/api/v1/slots",
        token: "invalid-token",
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await request({
        host: "pi-api.smartvendingpt.com",
        method: "GET",
        path: "/api/v1/slots",
        token: "valid-token",
      })
    ).status,
    200,
  );
});

test("logs only a fixed failure category and preserves the generic 401 response", async () => {
  const categories: AccessJwtFailureCategory[] = [];
  const response = await request({
    host: "pi-api.smartvendingpt.com",
    method: "GET",
    path: "/api/v1/slots",
    token: "opaque-token-value",
    verifier: async () => {
      throw new AccessJwtVerificationError("audience_mismatch");
    },
    logVerificationFailure: (category) => categories.push(category),
  });

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Machine authentication failed." });
  assert.deepEqual(categories, ["audience_mismatch"]);
});

test("Pi hostname denies non-allowlisted routes even with a valid JWT", async () => {
  for (const [method, path] of [
    ["GET", "/api/v1/admin/slots"],
    ["POST", "/api/v1/employees"],
    ["POST", "/api/v1/transactions/omise/webhook"],
    ["POST", "/unlock"],
  ]) {
    const response = await request({
      host: "pi-api.smartvendingpt.com",
      method,
      path,
      token: "valid-token",
    });
    assert.equal(response.status, 404, `${method} ${path}`);
  }
});

test("forwarding headers cannot select or bypass the Pi machine boundary", async () => {
  const humanRequest = await request({
    host: "vending.smartvendingpt.com",
    forwardedHost: "pi-api.smartvendingpt.com",
    method: "GET",
    path: "/api/v1/admin/slots",
  });
  assert.equal(humanRequest.status, 200);

  const piRequest = await request({
    host: "pi-api.smartvendingpt.com",
    forwardedHost: "vending.smartvendingpt.com",
    method: "GET",
    path: "/api/v1/admin/slots",
    token: "valid-token",
  });
  assert.equal(piRequest.status, 404);
});

test("human hostname remains outside the Pi guard for Access and webhook handling", async () => {
  const response = await request({
    host: "vending.smartvendingpt.com",
    method: "POST",
    path: "/api/v1/transactions/omise/webhook",
  });
  assert.equal(response.status, 200);
});

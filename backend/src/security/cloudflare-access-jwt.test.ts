import assert from "node:assert/strict";
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import test from "node:test";
import {
  AccessJwtVerificationError,
  createCloudflareAccessJwtVerifier,
  type JwksProvider,
} from "./cloudflare-access-jwt";

const NOW = 1_800_000_000;
const ISSUER = "https://smart-vending.cloudflareaccess.com";
const AUDIENCE = "pi-application-audience";
const CLIENT_ID = "pi-service-token.access";
const KID = "test-signing-key";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});

const provider: JwksProvider = {
  async getKey(kid: string): Promise<KeyObject | null> {
    return kid === KID ? publicKey : null;
  },
};

function token(
  claims: Record<string, unknown> = {},
  options: { key?: KeyObject; header?: Record<string, unknown> } = {},
): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", typ: "JWT", kid: KID, ...options.header }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      type: "app",
      aud: [AUDIENCE],
      exp: NOW + 300,
      iat: NOW - 10,
      iss: ISSUER,
      common_name: CLIENT_ID,
      sub: "",
      ...claims,
    }),
  ).toString("base64url");
  const signature = sign(
    "RSA-SHA256",
    Buffer.from(`${header}.${payload}`, "ascii"),
    options.key ?? privateKey,
  ).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

function verifier() {
  return createCloudflareAccessJwtVerifier({
    issuer: ISSUER,
    audience: AUDIENCE,
    serviceTokenClientId: CLIENT_ID,
    jwksProvider: provider,
    now: () => NOW,
  });
}

test("accepts a correctly signed Pi service-token application JWT", async () => {
  const claims = await verifier()(token());
  assert.equal(claims.common_name, CLIENT_ID);
  assert.deepEqual(claims.aud, [AUDIENCE]);
  assert.equal(claims.sub, "");
});

test("rejects invalid signature, algorithm, key ID, and malformed tokens", async () => {
  const otherKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
  const cases = [
    token({}, { key: otherKey }),
    token({}, { header: { alg: "HS256" } }),
    token({}, { header: { kid: "unknown" } }),
    "not-a-jwt",
    "a.b.c",
  ];
  for (const value of cases) {
    await assert.rejects(verifier()(value), AccessJwtVerificationError);
  }
});

test("rejects expired, future, wrong-audience, wrong-issuer, and wrong-identity claims", async () => {
  const cases = [
    { exp: NOW },
    { iat: NOW + 31 },
    { nbf: NOW + 31 },
    { aud: ["human-application-audience"] },
    { iss: "https://attacker.cloudflareaccess.com" },
    { common_name: "other-service-token.access" },
    { sub: "identity-user" },
    { type: "org" },
  ];
  for (const claims of cases) {
    await assert.rejects(verifier()(token(claims)), AccessJwtVerificationError);
  }
});

test("rejects missing required claims", async () => {
  const requiredClaims = ["exp", "iat", "iss", "aud", "common_name", "sub", "type"];
  for (const claim of requiredClaims) {
    await assert.rejects(verifier()(token({ [claim]: undefined })), AccessJwtVerificationError);
  }
});

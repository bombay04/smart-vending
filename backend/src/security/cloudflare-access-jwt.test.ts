import assert from "node:assert/strict";
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import test from "node:test";
import {
  AccessJwtVerificationError,
  createCloudflareAccessJwtVerifier,
  type AccessJwtFailureCategory,
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

async function assertFailureCategory(
  promise: Promise<unknown>,
  category: AccessJwtFailureCategory,
): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof AccessJwtVerificationError);
    assert.equal(error.category, category);
    assert.equal(error.message, "Cloudflare Access JWT verification failed.");
    return true;
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
  const signatureCases = [
    token({}, { key: otherKey }),
    token({}, { header: { alg: "HS256" } }),
    "not-a-jwt",
    "a.b.c",
  ];
  for (const value of signatureCases) {
    await assertFailureCategory(verifier()(value), "invalid_jwt_signature_or_algorithm");
  }
  await assertFailureCategory(
    verifier()(token({}, { header: { kid: "unknown" } })),
    "jwks_fetch_or_key_resolution_failure",
  );
});

test("categorizes claim and timestamp mismatches without exposing values", async () => {
  const cases = [
    [{ exp: NOW }, "timestamp_validation_failure"],
    [{ iat: NOW + 31 }, "timestamp_validation_failure"],
    [{ nbf: NOW + 31 }, "timestamp_validation_failure"],
    [{ aud: ["human-application-audience"] }, "audience_mismatch"],
    [{ iss: "https://attacker.cloudflareaccess.com" }, "issuer_mismatch"],
    [{ common_name: "other-service-token.access" }, "service_token_client_id_mismatch"],
    [{ sub: "identity-user" }, "token_type_or_subject_mismatch"],
    [{ type: "org" }, "token_type_or_subject_mismatch"],
  ] as const;
  for (const [claims, category] of cases) {
    await assertFailureCategory(verifier()(token(claims)), category);
  }
});

test("categorizes missing required claims", async () => {
  await assertFailureCategory(verifier()(token({ iss: undefined })), "issuer_mismatch");
  await assertFailureCategory(verifier()(token({ aud: undefined })), "audience_mismatch");
  await assertFailureCategory(
    verifier()(token({ common_name: undefined })),
    "service_token_client_id_mismatch",
  );
  await assertFailureCategory(
    verifier()(token({ sub: undefined })),
    "token_type_or_subject_mismatch",
  );
  await assertFailureCategory(
    verifier()(token({ type: undefined })),
    "token_type_or_subject_mismatch",
  );
  await assertFailureCategory(
    verifier()(token({ exp: undefined })),
    "timestamp_validation_failure",
  );
  await assertFailureCategory(
    verifier()(token({ iat: undefined })),
    "timestamp_validation_failure",
  );
});

test("categorizes JWKS provider and verifier configuration failures", async () => {
  const failingProvider: JwksProvider = {
    async getKey() {
      throw new Error("simulated network failure");
    },
  };
  const verifyWithFailingProvider = createCloudflareAccessJwtVerifier({
    issuer: ISSUER,
    audience: AUDIENCE,
    serviceTokenClientId: CLIENT_ID,
    jwksProvider: failingProvider,
    now: () => NOW,
  });
  await assertFailureCategory(
    verifyWithFailingProvider(token()),
    "jwks_fetch_or_key_resolution_failure",
  );

  assert.throws(
    () =>
      createCloudflareAccessJwtVerifier({
        issuer: ISSUER,
        audience: "",
        serviceTokenClientId: CLIENT_ID,
        jwksProvider: provider,
      }),
    (error: unknown) => {
      assert.ok(error instanceof AccessJwtVerificationError);
      assert.equal(error.category, "invalid_verifier_configuration");
      return true;
    },
  );
});

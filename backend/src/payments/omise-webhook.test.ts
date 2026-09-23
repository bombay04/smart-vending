import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { HttpError } from "../utils/http-error";
import { parseOmiseWebhookChargeId, verifyOmiseWebhookSignature } from "./omise-webhook";

test("valid Omise HMAC signatures are accepted", () => {
  const secretBytes = Buffer.from("prototype-webhook-secret");
  const secret = secretBytes.toString("base64");
  const timestamp = "1790154000";
  const rawBody = Buffer.from('{"object":"event"}');
  const signature = createHmac("sha256", secretBytes)
    .update(Buffer.concat([Buffer.from(`${timestamp}.`), rawBody]))
    .digest("hex");

  assert.doesNotThrow(() =>
    verifyOmiseWebhookSignature(rawBody, signature, timestamp, secret, 1_790_154_000_000),
  );
});

test("webhook secret rotation accepts a matching comma-separated signature", () => {
  const secretBytes = Buffer.from("new-webhook-secret");
  const timestamp = "1790154000";
  const rawBody = Buffer.from('{"object":"event","key":"charge.complete"}');
  const matchingSignature = createHmac("sha256", secretBytes)
    .update(Buffer.concat([Buffer.from(`${timestamp}.`), rawBody]))
    .digest("hex");

  assert.doesNotThrow(() =>
    verifyOmiseWebhookSignature(
      rawBody,
      `${"0".repeat(64)},${matchingSignature}`,
      timestamp,
      secretBytes.toString("base64"),
      1_790_154_000_000,
    ),
  );
});

test("invalid, missing, and stale webhook signatures fail safely", () => {
  for (const [signature, timestamp] of [
    [undefined, undefined],
    ["not-a-signature", "1790154000"],
    ["0".repeat(64), "1790153000"],
  ] as const) {
    assert.throws(
      () =>
        verifyOmiseWebhookSignature(
          Buffer.from("{}"),
          signature,
          timestamp,
          Buffer.from("secret").toString("base64"),
          1_790_154_000_000,
        ),
      (error: unknown) => error instanceof HttpError && error.statusCode === 401,
    );
  }
});

test("only well-formed charge.complete events yield a charge identifier", () => {
  assert.equal(
    parseOmiseWebhookChargeId({
      object: "event",
      key: "charge.complete",
      data: { object: "charge", id: "chrg_test_abc123" },
    }),
    "chrg_test_abc123",
  );
  assert.equal(parseOmiseWebhookChargeId({ object: "event", key: "charge.create" }), null);
  assert.throws(
    () =>
      parseOmiseWebhookChargeId({
        object: "event",
        key: "charge.complete",
        data: { object: "charge", id: "not-a-charge" },
      }),
    (error: unknown) => error instanceof HttpError && error.statusCode === 400,
  );
});

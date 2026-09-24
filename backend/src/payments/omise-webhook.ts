import { createHmac, timingSafeEqual } from "node:crypto";
import { HttpError } from "../utils/http-error";

const MAX_SIGNATURE_AGE_SECONDS = 300;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function verifyOmiseWebhookSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  timestampHeader: string | undefined,
  secret: string,
  nowMilliseconds = Date.now(),
): void {
  if (!signatureHeader || !timestampHeader || !/^\d+$/.test(timestampHeader)) {
    throw new HttpError("Invalid webhook signature.", 401);
  }

  const timestamp = Number(timestampHeader);
  const age = Math.abs(Math.floor(nowMilliseconds / 1000) - timestamp);
  if (!Number.isSafeInteger(timestamp) || age > MAX_SIGNATURE_AGE_SECONDS) {
    throw new HttpError("Invalid webhook signature.", 401);
  }

  const decodedSecret = Buffer.from(secret, "base64");
  if (decodedSecret.length === 0) {
    throw new HttpError("Webhook signature verification is not configured.", 503);
  }

  const signedPayload = Buffer.concat([Buffer.from(`${timestampHeader}.`, "utf8"), rawBody]);
  const expected = createHmac("sha256", decodedSecret).update(signedPayload).digest();
  const matches = signatureHeader.split(",").some((candidate) => {
    const trimmed = candidate.trim();
    if (!/^[0-9a-f]{64}$/i.test(trimmed)) {
      return false;
    }
    const received = Buffer.from(trimmed, "hex");
    return received.length === expected.length && timingSafeEqual(received, expected);
  });

  if (!matches) {
    throw new HttpError("Invalid webhook signature.", 401);
  }
}

export function parseOmiseWebhookChargeId(body: unknown): string | null {
  if (!isRecord(body) || body.object !== "event" || body.key !== "charge.complete") {
    return null;
  }
  if (!isRecord(body.data) || body.data.object !== "charge") {
    throw new HttpError("Malformed webhook payload.", 400);
  }

  const chargeId = body.data.id;
  if (typeof chargeId !== "string" || !/^chrg_(?:test_)?[0-9a-z]+$/i.test(chargeId)) {
    throw new HttpError("Malformed webhook payload.", 400);
  }

  return chargeId;
}

import { createHmac, timingSafeEqual } from "node:crypto";
import { HttpError } from "../utils/http-error";
import { PILOT_KIOSK_MACHINE_ID } from "./kiosk-session.service";

export interface FaceAuthorizationClaims {
  sessionId: number;
  employeeCode: string;
  expiresAt: number;
  nonce: string;
}

export function getRestockUnlockSecret(): string {
  const secret = process.env.RESTOCK_UNLOCK_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new HttpError("Restock unlock authorization is unavailable.", 503);
  }
  return secret;
}

function verifySignature(encoded: string, supplied: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(encoded).digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(supplied, "base64url");
  } catch {
    return false;
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function verifyFaceAuthorization(
  value: unknown,
  expectedSessionId: number,
  secret = getRestockUnlockSecret(),
  now = new Date(),
): FaceAuthorizationClaims {
  if (typeof value !== "string") {
    throw new HttpError("Face authorization is required.", 403);
  }
  const parts = value.split(".");
  if (parts.length !== 2 || !verifySignature(parts[0], parts[1], secret)) {
    throw new HttpError("Face authorization is invalid or expired.", 403);
  }

  let claims: Record<string, unknown>;
  try {
    const decoded = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded))
      throw new Error();
    claims = decoded as Record<string, unknown>;
  } catch {
    throw new HttpError("Face authorization is invalid or expired.", 403);
  }

  if (
    claims.v !== 1 ||
    claims.purpose !== "FACE_MATCH" ||
    claims.machineId !== PILOT_KIOSK_MACHINE_ID ||
    claims.sessionId !== expectedSessionId ||
    typeof claims.employeeCode !== "string" ||
    claims.employeeCode.length === 0 ||
    typeof claims.expiresAt !== "number" ||
    !Number.isSafeInteger(claims.expiresAt) ||
    claims.expiresAt <= now.getTime() ||
    typeof claims.nonce !== "string" ||
    claims.nonce.length < 16
  ) {
    throw new HttpError("Face authorization is invalid or expired.", 403);
  }

  return {
    sessionId: claims.sessionId as number,
    employeeCode: claims.employeeCode,
    expiresAt: claims.expiresAt,
    nonce: claims.nonce,
  };
}

export function signRestockUnlockAuthorization(
  claims: Record<string, unknown>,
  secret = getRestockUnlockSecret(),
): string {
  const encoded = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

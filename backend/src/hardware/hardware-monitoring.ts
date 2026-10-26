export const HEARTBEAT_VERSION = 1;
export const LINE_RETRY_KEY_VALIDITY_MS = 24 * 60 * 60_000;
export const HARDWARE_ALERT_MAX_ATTEMPTS = 5;

export interface HardwareHeartbeatInput {
  version: 1;
  machineId: string;
  sequence: bigint;
  observedAt: Date;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function date(value: unknown): Date | null {
  if (typeof value !== "string" || value.length > 40) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export class InvalidHeartbeatError extends Error {}

export function isHeartbeatStale(
  lastSequence: bigint | null,
  lastObservedAt: Date | null,
  heartbeat: Pick<HardwareHeartbeatInput, "sequence" | "observedAt">,
): boolean {
  return (
    (lastSequence !== null && heartbeat.sequence <= lastSequence) ||
    (lastObservedAt !== null && heartbeat.observedAt <= lastObservedAt)
  );
}

export function parseHeartbeat(value: unknown, now = new Date()): HardwareHeartbeatInput {
  const body = record(value);
  if (!body) throw new InvalidHeartbeatError("Heartbeat must be a JSON object.");
  const allowedFields = new Set(["version", "machineId", "sequence", "observedAt"]);
  if (Object.keys(body).some((field) => !allowedFields.has(field))) {
    throw new InvalidHeartbeatError("Heartbeat contains unsupported fields.");
  }
  const observedAt = date(body.observedAt);
  if (
    body.version !== HEARTBEAT_VERSION ||
    typeof body.machineId !== "string" ||
    !/^[A-Z0-9][A-Z0-9_-]{2,63}$/.test(body.machineId) ||
    !Number.isSafeInteger(body.sequence) ||
    (body.sequence as number) <= 0 ||
    !observedAt
  ) {
    throw new InvalidHeartbeatError("Heartbeat fields are invalid.");
  }
  if (observedAt.getTime() > now.getTime() + 120_000) {
    throw new InvalidHeartbeatError("Heartbeat timestamp is too far in the future.");
  }
  return {
    version: 1,
    machineId: body.machineId,
    sequence: BigInt(body.sequence as number),
    observedAt,
  };
}

export function isHardwareAlertRetryKeyExpired(retryKeyCreatedAt: Date, now = new Date()): boolean {
  return now.getTime() - retryKeyCreatedAt.getTime() >= LINE_RETRY_KEY_VALIDITY_MS;
}

export function hardwareAlertFailureDisposition(input: {
  retryable: boolean;
  attemptCount: number;
  retryKeyCreatedAt: Date;
  now?: Date;
}): "FAILED" | "MANUAL_REVIEW" {
  const now = input.now ?? new Date();
  if (
    !input.retryable ||
    input.attemptCount >= HARDWARE_ALERT_MAX_ATTEMPTS ||
    isHardwareAlertRetryKeyExpired(input.retryKeyCreatedAt, now)
  ) {
    return "MANUAL_REVIEW";
  }
  return "FAILED";
}

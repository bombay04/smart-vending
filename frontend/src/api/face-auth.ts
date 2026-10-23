import { PI_UNLOCK_BASE_URL } from "../config/api";

export type FaceAuthenticationFailureStatus =
  | "NO_MATCH"
  | "NO_FACE"
  | "MULTIPLE_FACES"
  | "LIVENESS_FAILED"
  | "CANCELLED"
  | "BUSY"
  | "UNAVAILABLE"
  | "LOCKED";

export interface FaceAuthenticationMatch {
  status: "MATCH";
  employeeCode: string;
  distance: number;
  threshold: number;
  authorization: string;
}

export type FaceAuthenticationServiceStatus =
  | {
      status: "READY";
      failedAttempts: number;
      remainingAttempts: number;
    }
  | {
      status: "LOCKED";
      retryAfterSeconds: number;
    };

export class FaceAuthenticationError extends Error {
  constructor(
    readonly status: FaceAuthenticationFailureStatus,
    readonly remainingAttempts?: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(status);
    this.name = "FaceAuthenticationError";
  }
}

const faceAuthenticationUrl = `${PI_UNLOCK_BASE_URL}/face/authenticate`;
const faceAuthenticationStatusUrl = `${PI_UNLOCK_BASE_URL}/face/auth/status`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

export async function requestFaceAuthenticationStatus(
  signal?: AbortSignal,
): Promise<FaceAuthenticationServiceStatus> {
  const response = await fetch(faceAuthenticationStatusUrl, {
    cache: "no-store",
    signal,
  });
  const responseData = await readJson(response);

  if (response.status === 200 && response.ok && isRecord(responseData)) {
    if (
      responseData.status === "READY" &&
      isNonNegativeInteger(responseData.failedAttempts) &&
      isNonNegativeInteger(responseData.remainingAttempts)
    ) {
      return {
        status: "READY",
        failedAttempts: responseData.failedAttempts,
        remainingAttempts: responseData.remainingAttempts,
      };
    }

    if (
      responseData.status === "LOCKED" &&
      isPositiveInteger(responseData.retryAfterSeconds)
    ) {
      return {
        status: "LOCKED",
        retryAfterSeconds: responseData.retryAfterSeconds,
      };
    }
  }

  throw new FaceAuthenticationError("UNAVAILABLE");
}

export async function requestFaceAuthentication(
  sessionId: number,
  scanId: string,
  signal?: AbortSignal,
): Promise<FaceAuthenticationMatch> {
  const response = await fetch(faceAuthenticationUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, scanId }),
    signal,
  });
  const responseData = await readJson(response);

  if (response.ok) {
    if (
      response.status === 200 &&
      isRecord(responseData) &&
      responseData.status === "MATCH" &&
      typeof responseData.employeeCode === "string" &&
      responseData.employeeCode.trim().length > 0 &&
      typeof responseData.distance === "number" &&
      Number.isFinite(responseData.distance) &&
      typeof responseData.threshold === "number" &&
      Number.isFinite(responseData.threshold) &&
      typeof responseData.authorization === "string" &&
      responseData.authorization.length > 0
    ) {
      return {
        status: "MATCH",
        employeeCode: responseData.employeeCode,
        distance: responseData.distance,
        threshold: responseData.threshold,
        authorization: responseData.authorization,
      };
    }

    throw new FaceAuthenticationError("UNAVAILABLE");
  }

  if (isRecord(responseData)) {
    const status = responseData.status;
    if (
      response.status === 401 &&
      status === "NO_MATCH" &&
      isNonNegativeInteger(responseData.remainingAttempts)
    ) {
      throw new FaceAuthenticationError(
        "NO_MATCH",
        responseData.remainingAttempts,
      );
    }
    if (
      response.status === 422 &&
      (status === "NO_FACE" || status === "MULTIPLE_FACES") &&
      isNonNegativeInteger(responseData.remainingAttempts)
    ) {
      throw new FaceAuthenticationError(
        status,
        responseData.remainingAttempts,
      );
    }
    if (
      response.status === 422 &&
      status === "LIVENESS_FAILED" &&
      isNonNegativeInteger(responseData.remainingAttempts)
    ) {
      throw new FaceAuthenticationError(status, responseData.remainingAttempts);
    }
    if (response.status === 409 && status === "CANCELLED") {
      throw new FaceAuthenticationError("CANCELLED");
    }
    if (response.status === 409 && status === "BUSY") {
      throw new FaceAuthenticationError("BUSY");
    }
    if (response.status === 503 && status === "UNAVAILABLE") {
      throw new FaceAuthenticationError("UNAVAILABLE");
    }
    if (
      response.status === 423 &&
      status === "LOCKED" &&
      isPositiveInteger(responseData.retryAfterSeconds)
    ) {
      throw new FaceAuthenticationError(
        "LOCKED",
        undefined,
        responseData.retryAfterSeconds,
      );
    }
  }

  throw new FaceAuthenticationError("UNAVAILABLE");
}

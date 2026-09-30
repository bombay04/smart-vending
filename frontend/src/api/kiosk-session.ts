import { API_BASE_URL } from "../config/api";

export type KioskSessionType =
  | "RESTOCK_AUTH"
  | "FACE_REGISTRATION"
  | "EMPLOYEE_DRAFT_DELETE"
  | "EMPLOYEE_OFFBOARDING";
export type KioskSessionStatus =
  "ACTIVE" | "COMPLETED" | "EXPIRED" | "CANCELLED";

export interface KioskSessionEmployee {
  id: number;
  employeeCode: string;
  name: string;
}

export interface KioskSession {
  id: number;
  machineId: string;
  type: KioskSessionType;
  status: KioskSessionStatus;
  employeeId: number | null;
  employee: KioskSessionEmployee | null;
  createdAt: string;
  expiresAt: string;
  completedAt: string | null;
}

const sessionsUrl = `${API_BASE_URL}/api/v1/kiosk-sessions`;

export function isKioskSession(value: unknown): value is KioskSession {
  if (typeof value !== "object" || value === null) return false;
  const session = value as Record<string, unknown>;
  const employee = session.employee;
  const validEmployee =
    employee === null ||
    (typeof employee === "object" &&
      typeof (employee as Record<string, unknown>).id === "number" &&
      Number.isInteger((employee as Record<string, unknown>).id) &&
      typeof (employee as Record<string, unknown>).employeeCode === "string" &&
      (employee as Record<string, unknown>).employeeCode !== "" &&
      typeof (employee as Record<string, unknown>).name === "string" &&
      (employee as Record<string, unknown>).name !== "");
  const validEmployeeId =
    session.employeeId === null ||
    (typeof session.employeeId === "number" &&
      Number.isInteger(session.employeeId) &&
      session.employeeId > 0);
  const employeeMatchesType =
    (session.type === "RESTOCK_AUTH" &&
      session.employeeId === null &&
      employee === null) ||
    ([
      "FACE_REGISTRATION",
      "EMPLOYEE_DRAFT_DELETE",
      "EMPLOYEE_OFFBOARDING",
    ].includes(String(session.type)) &&
      typeof session.employeeId === "number" &&
      employee !== null &&
      typeof employee === "object" &&
      (employee as Record<string, unknown>).id === session.employeeId);
  return (
    typeof session.id === "number" &&
    Number.isInteger(session.id) &&
    session.id > 0 &&
    typeof session.machineId === "string" &&
    session.machineId !== "" &&
    [
      "RESTOCK_AUTH",
      "FACE_REGISTRATION",
      "EMPLOYEE_DRAFT_DELETE",
      "EMPLOYEE_OFFBOARDING",
    ].includes(String(session.type)) &&
    ["ACTIVE", "COMPLETED", "EXPIRED", "CANCELLED"].includes(
      String(session.status),
    ) &&
    validEmployee &&
    validEmployeeId &&
    employeeMatchesType &&
    typeof session.createdAt === "string" &&
    Number.isFinite(Date.parse(session.createdAt)) &&
    typeof session.expiresAt === "string" &&
    Number.isFinite(Date.parse(session.expiresAt))
  );
}

async function readSession(response: Response): Promise<KioskSession> {
  const payload = (await response.json()) as {
    session?: unknown;
    error?: unknown;
  };
  if (!response.ok || !isKioskSession(payload.session)) {
    throw new Error(
      typeof payload.error === "string"
        ? payload.error
        : "Kiosk session request failed.",
    );
  }
  return payload.session;
}

export async function fetchCurrentKioskSession(
  signal?: AbortSignal,
): Promise<KioskSession | null> {
  const response = await fetch(`${sessionsUrl}/current`, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error("Kiosk session status is unavailable.");
  const payload = (await response.json()) as { session?: unknown };
  if (payload.session === null) return null;
  if (!isKioskSession(payload.session) || payload.session.status !== "ACTIVE") {
    throw new Error("Kiosk session status is invalid.");
  }
  return payload.session;
}

export async function startRestockSession(
  signal?: AbortSignal,
): Promise<KioskSession> {
  return readSession(
    await fetch(`${sessionsUrl}/restock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal,
    }),
  );
}

export async function startFaceRegistrationSession(
  employeeId: number,
  signal?: AbortSignal,
): Promise<KioskSession> {
  return readSession(
    await fetch(`${sessionsUrl}/face-registration`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employeeId }),
      signal,
    }),
  );
}

export async function cancelKioskSession(
  sessionId: number,
  signal?: AbortSignal,
): Promise<KioskSession> {
  return readSession(
    await fetch(`${sessionsUrl}/${sessionId}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal,
    }),
  );
}

export async function completeKioskSession(
  sessionId: number,
  signal?: AbortSignal,
): Promise<KioskSession> {
  return readSession(
    await fetch(`${sessionsUrl}/${sessionId}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal,
    }),
  );
}

async function postMaintenanceResult(
  sessionId: number,
  suffix: "draft-delete-result" | "offboarding-complete",
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(`${sessionsUrl}/${sessionId}/${suffix}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) throw new Error("Kiosk cleanup result was not accepted.");
}

export const reportDraftDeleteResult = (
  sessionId: number,
  templateExists: boolean,
  signal?: AbortSignal,
) =>
  postMaintenanceResult(
    sessionId,
    "draft-delete-result",
    { templateExists },
    signal,
  );

export const completeEmployeeOffboarding = (
  sessionId: number,
  signal?: AbortSignal,
) => postMaintenanceResult(sessionId, "offboarding-complete", {}, signal);

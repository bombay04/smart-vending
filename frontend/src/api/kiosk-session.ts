import { API_BASE_URL } from "../config/api";

export type KioskSessionType = "RESTOCK_AUTH" | "FACE_REGISTRATION";
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

function isSession(value: unknown): value is KioskSession {
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
    (session.type === "FACE_REGISTRATION" &&
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
    (session.type === "RESTOCK_AUTH" || session.type === "FACE_REGISTRATION") &&
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
  if (!response.ok || !isSession(payload.session)) {
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
  if (!isSession(payload.session) || payload.session.status !== "ACTIVE") {
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

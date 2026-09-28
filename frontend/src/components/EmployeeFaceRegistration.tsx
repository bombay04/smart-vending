import { useEffect, useRef, useState } from "react";
import {
  FaceRegistrationError,
  fetchFaceRegistrationStatuses,
  registerEmployeeFace,
} from "../api/face-registration";
import { completeEmployeeFaceRegistration } from "../api/employee-auth";
import type { KioskSession } from "../api/kiosk-session";
import { fetchCurrentKioskSession } from "../api/kiosk-session";

type RegistrationState =
  | "CHECKING"
  | "READY"
  | "CAPTURING"
  | "SYNC_REQUIRED"
  | "SYNCING"
  | "SYNC_ERROR"
  | "SUCCESS"
  | "NO_FACE"
  | "MULTIPLE_FACES"
  | "BUSY"
  | "PI_UNAVAILABLE";

const CONTENT: Record<
  RegistrationState,
  { title: string; instruction: string }
> = {
  CHECKING: {
    title: "Checking registration",
    instruction: "Checking this Pi for an existing local template...",
  },
  READY: {
    title: "Ready to register",
    instruction:
      "Ask the named employee to face the camera alone, then start registration.",
  },
  CAPTURING: {
    title: "Capturing face",
    instruction:
      "Keep one face centered while five stabilized captures are collected.",
  },
  SYNC_REQUIRED: {
    title: "Status sync required",
    instruction:
      "A local template already exists. Sync its status without capturing again.",
  },
  SYNCING: {
    title: "Syncing status",
    instruction:
      "The local template remains safe while backend metadata and the session are completed...",
  },
  SYNC_ERROR: {
    title: "Status sync incomplete",
    instruction:
      "The template is saved locally. Retry sync without recapturing.",
  },
  SUCCESS: {
    title: "Registration complete",
    instruction:
      "The local template was saved and the authorized session is complete.",
  },
  NO_FACE: {
    title: "No face detected",
    instruction: "Move into view, improve lighting, and try again.",
  },
  MULTIPLE_FACES: {
    title: "Multiple faces detected",
    instruction: "Only the authorized employee may remain in camera view.",
  },
  BUSY: {
    title: "Camera busy",
    instruction: "Another scan is using the camera. Try again shortly.",
  },
  PI_UNAVAILABLE: {
    title: "Pi service unavailable",
    instruction: "Check the local face service and try again.",
  },
};

interface EmployeeFaceRegistrationProps {
  session: KioskSession;
  onCancel: () => void;
  onCompleted: () => void;
}

function EmployeeFaceRegistration({
  session,
  onCancel,
  onCompleted,
}: EmployeeFaceRegistrationProps) {
  const employee = session.employee;
  const [state, setState] = useState<RegistrationState>("CHECKING");
  const activeRequestRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (employee === null) {
      onCancel();
      return undefined;
    }
    const controller = new AbortController();
    activeRequestRef.current = controller;
    void fetchFaceRegistrationStatuses(
      [employee.employeeCode],
      controller.signal,
    )
      .then(([status]) =>
        setState(status?.registered ? "SYNC_REQUIRED" : "READY"),
      )
      .catch(() => {
        if (!controller.signal.aborted) setState("PI_UNAVAILABLE");
      });
    return () => controller.abort();
  }, [employee, onCancel]);

  useEffect(() => {
    if (state !== "SUCCESS") return undefined;
    const timeoutId = window.setTimeout(onCompleted, 2000);
    return () => window.clearTimeout(timeoutId);
  }, [onCompleted, state]);

  async function syncCompletion() {
    if (employee === null) return;
    const controller = new AbortController();
    activeRequestRef.current?.abort();
    activeRequestRef.current = controller;
    setState("SYNCING");
    try {
      await completeEmployeeFaceRegistration(session.id, controller.signal);
      setState("SUCCESS");
    } catch {
      if (!controller.signal.aborted) setState("SYNC_ERROR");
    }
  }

  async function capture() {
    if (employee === null) return;
    const controller = new AbortController();
    activeRequestRef.current?.abort();
    activeRequestRef.current = controller;
    setState("CAPTURING");
    try {
      const authorizedSession = await fetchCurrentKioskSession(
        controller.signal,
      );
      if (
        authorizedSession?.id !== session.id ||
        authorizedSession.type !== "FACE_REGISTRATION" ||
        authorizedSession.employee?.id !== employee.id
      ) {
        onCancel();
        return;
      }
      await registerEmployeeFace(employee.employeeCode, controller.signal);
      await syncCompletion();
    } catch (error: unknown) {
      if (controller.signal.aborted) return;
      if (error instanceof FaceRegistrationError) {
        if (error.status === "ALREADY_REGISTERED") setState("SYNC_REQUIRED");
        else
          setState(
            error.status === "UNAVAILABLE" ? "PI_UNAVAILABLE" : error.status,
          );
      } else setState("PI_UNAVAILABLE");
    }
  }

  if (employee === null) return null;
  const busy =
    state === "CHECKING" || state === "CAPTURING" || state === "SYNCING";
  const retryCapture = [
    "NO_FACE",
    "MULTIPLE_FACES",
    "BUSY",
    "PI_UNAVAILABLE",
  ].includes(state);

  return (
    <main className="home-page employee-registration-page">
      <section
        className="employee-registration-card"
        aria-labelledby="registration-title"
      >
        <p className="mode-label mode-label--admin">Authorized Staff Session</p>
        <h1 id="registration-title">Employee Face Setup</h1>
        <div
          className="employee-registration-status"
          aria-live="polite"
          aria-busy={busy}
        >
          <h2>{CONTENT[state].title}</h2>
          <p>{CONTENT[state].instruction}</p>
          <p className="employee-registration-identity">
            {employee.name} - {employee.employeeCode}
          </p>
        </div>
        <div className="employee-registration-actions">
          {(state === "READY" || retryCapture) && (
            <button
              className="employee-registration-submit"
              type="button"
              onClick={() => void capture()}
            >
              {retryCapture ? "Try Capture Again" : "Start Face Registration"}
            </button>
          )}
          {(state === "SYNC_REQUIRED" || state === "SYNC_ERROR") && (
            <button
              className="employee-registration-submit"
              type="button"
              onClick={() => void syncCompletion()}
            >
              {state === "SYNC_ERROR"
                ? "Retry Status Sync"
                : "Sync Registration Status"}
            </button>
          )}
        </div>
        <button
          className="employee-registration-back"
          type="button"
          disabled={busy}
          onClick={onCancel}
        >
          Back to Customer Mode
        </button>
      </section>
    </main>
  );
}

export default EmployeeFaceRegistration;

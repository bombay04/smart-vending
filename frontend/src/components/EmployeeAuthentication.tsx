import { useEffect, useRef, useState } from "react";
import {
  EmployeeValidationError,
  validateFaceAuthenticatedEmployee,
} from "../api/employee-auth";
import {
  FaceAuthenticationError,
  requestFaceAuthentication,
  type FaceAuthenticationFailureStatus,
} from "../api/face-auth";
import type { AuthenticatedEmployee } from "../types/employee";

interface EmployeeAuthenticationProps {
  onAuthenticated: (employee: AuthenticatedEmployee) => void;
  onCancel: () => void;
}

type AuthenticationState = "IDLE" | "SCANNING" | "SUCCESS" | FaceAuthenticationFailureStatus;

const STATE_CONTENT: Record<AuthenticationState, { title: string; instruction: string }> = {
  IDLE: {
    title: "Ready to Scan",
    instruction: "Face the camera, make sure you are the only person visible, then tap Scan Face.",
  },
  SCANNING: {
    title: "Scanning Face",
    instruction: "Look directly at the camera and keep still while three samples are captured.",
  },
  SUCCESS: {
    title: "Authentication Successful",
    instruction: "Employee identity verified. Opening Restock Mode...",
  },
  NO_MATCH: {
    title: "Face Not Recognized",
    instruction: "We could not verify an active employee. Adjust your position and try again.",
  },
  NO_FACE: {
    title: "No Face Detected",
    instruction: "Center your face in front of the camera, then try again.",
  },
  MULTIPLE_FACES: {
    title: "One Person at a Time",
    instruction: "Make sure only one person is visible to the camera, then try again.",
  },
  BUSY: {
    title: "Scanner Busy",
    instruction: "Another scan is in progress. Wait a moment, then try again.",
  },
  UNAVAILABLE: {
    title: "Scanner Unavailable",
    instruction: "Face authentication is unavailable. Check the camera service and try again.",
  },
};

function EmployeeAuthentication({ onAuthenticated, onCancel }: EmployeeAuthenticationProps) {
  const [authenticationState, setAuthenticationState] =
    useState<AuthenticationState>("IDLE");
  const [authenticatedEmployee, setAuthenticatedEmployee] =
    useState<AuthenticatedEmployee | null>(null);
  const activeRequestRef = useRef<AbortController | null>(null);
  const requestInProgressRef = useRef(false);
  const completionTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      activeRequestRef.current?.abort();
      if (completionTimerRef.current !== null) {
        window.clearTimeout(completionTimerRef.current);
      }
    },
    [],
  );

  async function handleScan() {
    if (requestInProgressRef.current || authenticationState === "SUCCESS") {
      return;
    }

    const requestController = new AbortController();
    requestInProgressRef.current = true;
    activeRequestRef.current = requestController;
    setAuthenticatedEmployee(null);
    setAuthenticationState("SCANNING");

    try {
      const faceMatch = await requestFaceAuthentication(requestController.signal);
      const employee = await validateFaceAuthenticatedEmployee(
        faceMatch.employeeCode,
        requestController.signal,
      );

      if (requestController.signal.aborted) {
        return;
      }

      setAuthenticatedEmployee(employee);
      setAuthenticationState("SUCCESS");
      completionTimerRef.current = window.setTimeout(() => {
        completionTimerRef.current = null;
        onAuthenticated(employee);
      }, 700);
    } catch (error: unknown) {
      if (requestController.signal.aborted) {
        return;
      }

      if (error instanceof FaceAuthenticationError) {
        setAuthenticationState(error.status);
      } else if (error instanceof EmployeeValidationError && error.rejected) {
        setAuthenticationState("NO_MATCH");
      } else {
        setAuthenticationState("UNAVAILABLE");
      }
    } finally {
      requestInProgressRef.current = false;
      if (activeRequestRef.current === requestController) {
        activeRequestRef.current = null;
      }
    }
  }

  function handleCancel() {
    activeRequestRef.current?.abort();
    if (completionTimerRef.current !== null) {
      window.clearTimeout(completionTimerRef.current);
      completionTimerRef.current = null;
    }
    requestInProgressRef.current = false;
    setAuthenticatedEmployee(null);
    onCancel();
  }

  const content = STATE_CONTENT[authenticationState];
  const isScanning = authenticationState === "SCANNING";
  const isSuccessful = authenticationState === "SUCCESS";
  const isFailure = !["IDLE", "SCANNING", "SUCCESS"].includes(authenticationState);

  return (
    <main className="home-page employee-auth-page">
      <section className="employee-auth-card" aria-labelledby="employee-auth-title">
        <p className="mode-label mode-label--employee">Employee Mode</p>
        <div
          className={`face-scan-indicator face-scan-indicator--${authenticationState.toLowerCase()}`}
          aria-hidden="true"
        >
          <span>{isSuccessful ? "✓" : "◎"}</span>
        </div>
        <h1 id="employee-auth-title">Face Authentication</h1>
        <div className="employee-auth-status" aria-live="polite" aria-busy={isScanning}>
          <h2>{content.title}</h2>
          <p>{content.instruction}</p>
          {authenticatedEmployee && (
            <p className="employee-auth-identity">Welcome, {authenticatedEmployee.name}</p>
          )}
        </div>

        <div className="employee-auth-actions">
          <button
            className="employee-auth-submit"
            type="button"
            disabled={isScanning || isSuccessful}
            onClick={() => void handleScan()}
          >
            {isScanning ? "Scanning..." : isFailure ? "Try Again" : "Scan Face"}
          </button>
          <button className="employee-auth-cancel" type="button" onClick={handleCancel}>
            Back to Customer Mode
          </button>
        </div>
      </section>
    </main>
  );
}

export default EmployeeAuthentication;

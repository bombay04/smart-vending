import { useCallback, useEffect, useRef, useState } from "react";
import {
  EmployeeValidationError,
  validateFaceAuthenticatedEmployee,
} from "../api/employee-auth";
import {
  FaceAuthenticationError,
  requestFaceAuthentication,
  requestFaceAuthenticationStatus,
  type FaceAuthenticationFailureStatus,
} from "../api/face-auth";
import type { AuthenticatedEmployee } from "../types/employee";

interface EmployeeAuthenticationProps {
  onAuthenticated: (employee: AuthenticatedEmployee) => void;
  onCancel: () => void;
}

type AuthenticationState =
  | "CHECKING"
  | "IDLE"
  | "SCANNING"
  | "SUCCESS"
  | FaceAuthenticationFailureStatus;

const STATE_CONTENT: Record<AuthenticationState, { title: string; instruction: string }> = {
  CHECKING: {
    title: "Checking Scanner",
    instruction: "Checking whether employee face authentication is available...",
  },
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
  LOCKED: {
    title: "Face Authentication Locked",
    instruction: "Too many failed attempts. Face scanning is temporarily disabled.",
  },
};

function formatCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function EmployeeAuthentication({ onAuthenticated, onCancel }: EmployeeAuthenticationProps) {
  const [authenticationState, setAuthenticationState] =
    useState<AuthenticationState>("CHECKING");
  const [authenticatedEmployee, setAuthenticatedEmployee] =
    useState<AuthenticatedEmployee | null>(null);
  const [remainingAttempts, setRemainingAttempts] = useState<number | null>(null);
  const [lockoutSeconds, setLockoutSeconds] = useState<number | null>(null);
  const [lockedUntilMs, setLockedUntilMs] = useState<number | null>(null);
  const activeRequestRef = useRef<AbortController | null>(null);
  const requestInProgressRef = useRef(false);
  const completionTimerRef = useRef<number | null>(null);

  const showLockout = useCallback((retryAfterSeconds: number) => {
    setRemainingAttempts(0);
    setLockoutSeconds(retryAfterSeconds);
    setLockedUntilMs(Date.now() + retryAfterSeconds * 1000);
    setAuthenticationState("LOCKED");
  }, []);

  useEffect(() => {
    const statusController = new AbortController();

    void requestFaceAuthenticationStatus(statusController.signal)
      .then((status) => {
        if (status.status === "LOCKED") {
          showLockout(status.retryAfterSeconds);
          return;
        }

        setRemainingAttempts(
          status.failedAttempts > 0 ? status.remainingAttempts : null,
        );
        setAuthenticationState("IDLE");
      })
      .catch(() => {
        if (!statusController.signal.aborted) {
          setAuthenticationState("UNAVAILABLE");
        }
      });

    return () => {
      statusController.abort();
    };
  }, [showLockout]);

  useEffect(() => {
    if (authenticationState !== "LOCKED" || lockedUntilMs === null) {
      return undefined;
    }

    const statusController = new AbortController();
    let expiryCheckStarted = false;

    const updateCountdown = () => {
      const seconds = Math.max(0, Math.ceil((lockedUntilMs - Date.now()) / 1000));
      setLockoutSeconds(seconds);

      if (seconds > 0 || expiryCheckStarted) {
        return;
      }

      expiryCheckStarted = true;
      window.clearInterval(intervalId);
      void requestFaceAuthenticationStatus(statusController.signal)
        .then((status) => {
          if (status.status === "LOCKED") {
            showLockout(status.retryAfterSeconds);
            return;
          }

          setLockedUntilMs(null);
          setLockoutSeconds(null);
          setRemainingAttempts(null);
          setAuthenticationState("IDLE");
        })
        .catch(() => {
          if (!statusController.signal.aborted) {
            setLockedUntilMs(null);
            setLockoutSeconds(null);
            setAuthenticationState("UNAVAILABLE");
          }
        });
    };

    const intervalId = window.setInterval(updateCountdown, 1000);
    updateCountdown();

    return () => {
      window.clearInterval(intervalId);
      statusController.abort();
    };
  }, [authenticationState, lockedUntilMs, showLockout]);

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
    if (
      requestInProgressRef.current ||
      authenticationState === "SUCCESS" ||
      authenticationState === "CHECKING" ||
      authenticationState === "LOCKED"
    ) {
      return;
    }

    const requestController = new AbortController();
    requestInProgressRef.current = true;
    activeRequestRef.current = requestController;
    setAuthenticatedEmployee(null);
    setAuthenticationState("SCANNING");

    try {
      const faceMatch = await requestFaceAuthentication(requestController.signal);
      setRemainingAttempts(null);
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
        if (error.status === "LOCKED" && error.retryAfterSeconds !== undefined) {
          showLockout(error.retryAfterSeconds);
        } else {
          if (error.remainingAttempts !== undefined) {
            setRemainingAttempts(error.remainingAttempts);
          }
          setAuthenticationState(error.status);
        }
      } else if (error instanceof EmployeeValidationError && error.rejected) {
        setRemainingAttempts(null);
        setAuthenticationState("NO_MATCH");
      } else {
        setRemainingAttempts(null);
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
  const isChecking = authenticationState === "CHECKING";
  const isScanning = authenticationState === "SCANNING";
  const isSuccessful = authenticationState === "SUCCESS";
  const isLocked = authenticationState === "LOCKED";
  const isFailure = !["CHECKING", "IDLE", "SCANNING", "SUCCESS", "LOCKED"].includes(
    authenticationState,
  );

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
          {remainingAttempts !== null && remainingAttempts > 0 && isFailure && (
            <p className="employee-auth-attempts">
              {remainingAttempts} {remainingAttempts === 1 ? "attempt" : "attempts"} remaining
              before temporary lockout.
            </p>
          )}
          {isLocked && lockoutSeconds !== null && (
            <p className="employee-auth-countdown">
              Try again in {formatCountdown(lockoutSeconds)}
            </p>
          )}
          {authenticatedEmployee && (
            <p className="employee-auth-identity">Welcome, {authenticatedEmployee.name}</p>
          )}
        </div>

        <div className="employee-auth-actions">
          <button
            className="employee-auth-submit"
            type="button"
            disabled={isChecking || isScanning || isSuccessful || isLocked}
            onClick={() => void handleScan()}
          >
            {isChecking
              ? "Checking..."
              : isScanning
                ? "Scanning..."
                : isLocked
                  ? "Temporarily Locked"
                  : isFailure
                    ? "Try Again"
                    : "Scan Face"}
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

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
import { playAudioFeedback } from "../api/audio";
import { validateEmployeeAndNotify } from "../audio-feedback.mjs";
import SuccessCheckIcon from "./SuccessCheckIcon";

interface EmployeeAuthenticationProps {
  sessionId: number;
  onAuthenticated: (employee: AuthenticatedEmployee) => void;
  onCancel: () => Promise<void>;
}

type AuthenticationState =
  | "CHECKING"
  | "IDLE"
  | "SCANNING"
  | "SUCCESS"
  | FaceAuthenticationFailureStatus;

const STATE_CONTENT: Record<
  AuthenticationState,
  { title?: string; instruction: string }
> = {
  CHECKING: {
    title: "กำลังตรวจสอบเครื่องสแกน",
    instruction: "กำลังตรวจสอบว่าระบบยืนยันตัวตนด้วยใบหน้าพร้อมใช้งานหรือไม่...",
  },
  IDLE: {
    instruction: "กรุณามองตรงไปที่กล้อง",
  },
  SCANNING: {
    title: "กำลังสแกนใบหน้า",
    instruction:
      "กรุณามองตรงไปที่กล้องและอยู่นิ่ง ขณะระบบกำลังสแกนใบหน้า",
  },
  SUCCESS: {
    title: "ยืนยันตัวตนสำเร็จ",
    instruction:
      "ยืนยันตัวตนพนักงานเรียบร้อยแล้ว กำลังเข้าสู่โหมดเติมสินค้า...",
  },
  NO_MATCH: {
    title: "ยืนยันตัวตนไม่สำเร็จ",
    instruction: "ไม่สามารถยืนยันตัวตนได้ กรุณาลองอีกครั้ง",
  },
  NO_FACE: {
    title: "ไม่พบใบหน้า",
    instruction:
      "กรุณาจัดใบหน้าให้อยู่ในตำแหน่งที่กล้องมองเห็น แล้วลองอีกครั้ง",
  },
  MULTIPLE_FACES: {
    title: "ตรวจพบหลายใบหน้า",
    instruction: "กรุณาให้พนักงานอยู่หน้ากล้องเพียงคนเดียว",
  },
  BUSY: {
    title: "กล้องกำลังถูกใช้งาน",
    instruction: "มีการใช้งานกล้องอยู่ กรุณาลองอีกครั้งในอีกสักครู่",
  },
  UNAVAILABLE: {
    title: "ไม่สามารถใช้งานเครื่องสแกนได้",
    instruction: "กรุณาตรวจสอบบริการสแกนใบหน้าบนเครื่อง แล้วลองอีกครั้ง",
  },
  LOCKED: {
    title: "ระบบยืนยันตัวตนถูกล็อกชั่วคราว",
    instruction:
      "มีการยืนยันตัวตนไม่สำเร็จหลายครั้ง ระบบสแกนใบหน้าจึงถูกปิดใช้งานชั่วคราว",
  },
};

function formatCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function EmployeeAuthentication({
  sessionId,
  onAuthenticated,
  onCancel,
}: EmployeeAuthenticationProps) {
  const [authenticationState, setAuthenticationState] =
    useState<AuthenticationState>("CHECKING");
  const [authenticatedEmployee, setAuthenticatedEmployee] =
    useState<AuthenticatedEmployee | null>(null);
  const [remainingAttempts, setRemainingAttempts] = useState<number | null>(
    null,
  );
  const [lockoutSeconds, setLockoutSeconds] = useState<number | null>(null);
  const [lockedUntilMs, setLockedUntilMs] = useState<number | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
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
      const seconds = Math.max(
        0,
        Math.ceil((lockedUntilMs - Date.now()) / 1000),
      );
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
      const faceMatch = await requestFaceAuthentication(
        requestController.signal,
      );
      setRemainingAttempts(null);
      const employee = await validateEmployeeAndNotify(
        faceMatch.employeeCode,
        requestController.signal,
        {
          validateEmployee: (employeeCode, signal) =>
            validateFaceAuthenticatedEmployee(employeeCode, sessionId, signal),
          playAudio: playAudioFeedback,
        },
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
        if (
          error.status === "LOCKED" &&
          error.retryAfterSeconds !== undefined
        ) {
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

  async function handleCancel() {
    if (isCancelling) return;
    activeRequestRef.current?.abort();
    if (completionTimerRef.current !== null) {
      window.clearTimeout(completionTimerRef.current);
      completionTimerRef.current = null;
    }
    requestInProgressRef.current = false;
    setAuthenticatedEmployee(null);
    setCancelError(null);
    setIsCancelling(true);
    try {
      await onCancel();
    } catch {
      setCancelError(
        "ไม่สามารถกลับสู่หน้าหลักได้ กรุณาตรวจสอบการเชื่อมต่อแล้วลองอีกครั้ง",
      );
      setAuthenticationState("IDLE");
    } finally {
      setIsCancelling(false);
    }
  }

  const content = STATE_CONTENT[authenticationState];
  const isChecking = authenticationState === "CHECKING";
  const isScanning = authenticationState === "SCANNING";
  const isSuccessful = authenticationState === "SUCCESS";
  const isLocked = authenticationState === "LOCKED";
  const isFailure = ![
    "CHECKING",
    "IDLE",
    "SCANNING",
    "SUCCESS",
    "LOCKED",
  ].includes(authenticationState);
  const statusTone = isSuccessful
    ? "success"
    : authenticationState === "BUSY"
      ? "busy"
      : isFailure || isLocked
        ? "error"
        : "ready";

  return (
    <main className="home-page employee-auth-page">
      <section
        className="employee-auth-card"
        aria-labelledby="employee-auth-title"
      >
        <div
          className={`face-scan-indicator face-scan-indicator--${authenticationState.toLowerCase()}`}
          aria-hidden="true"
        >
          {isSuccessful ? <SuccessCheckIcon /> : <span>◎</span>}
        </div>
        <h1 id="employee-auth-title">ยืนยันตัวตนพนักงาน</h1>
        <div
          className={`employee-auth-status face-flow-status face-flow-status--${statusTone}`}
          aria-live="polite"
          aria-busy={isScanning}
        >
          {content.title && <h2>{content.title}</h2>}
          <p>{content.instruction}</p>
          {remainingAttempts !== null && remainingAttempts > 0 && isFailure && (
            <p className="employee-auth-attempts">
              เหลืออีก {remainingAttempts} ครั้งก่อนระบบล็อกชั่วคราว
            </p>
          )}
          {isLocked && lockoutSeconds !== null && (
            <p className="employee-auth-countdown">
              ลองอีกครั้งใน {formatCountdown(lockoutSeconds)}
            </p>
          )}
          {authenticatedEmployee && (
            <p className="employee-auth-identity">
              ยินดีต้อนรับ {authenticatedEmployee.name}
            </p>
          )}
          {cancelError && (
            <p className="employee-auth-attempts">{cancelError}</p>
          )}
        </div>

        <div className="employee-auth-actions">
          <button
            className="employee-auth-submit"
            type="button"
            disabled={
              isChecking || isScanning || isSuccessful || isLocked || isCancelling
            }
            onClick={() => void handleScan()}
          >
            {isChecking
              ? "กำลังตรวจสอบ..."
              : isScanning
                ? "กำลังสแกน..."
                : isLocked
                  ? "ระบบถูกล็อกชั่วคราว"
                  : isFailure
                    ? "ลองอีกครั้ง"
                    : "สแกนใบหน้า"}
          </button>
          <button
            className="employee-auth-cancel"
            type="button"
            disabled={isCancelling}
            onClick={() => void handleCancel()}
          >
            {isCancelling ? "กำลังกลับสู่หน้าหลัก..." : "กลับสู่หน้าหลัก"}
          </button>
        </div>
      </section>
    </main>
  );
}

export default EmployeeAuthentication;

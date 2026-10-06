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
  { title?: string; instruction?: string }
> = {
  CHECKING: {
    title: "กำลังตรวจสอบการลงทะเบียน",
    instruction: "กำลังตรวจสอบข้อมูลใบหน้าที่บันทึกไว้ในเครื่อง...",
  },
  READY: { instruction: "กรุณามองตรงไปที่กล้อง" },
  CAPTURING: {
    title: "กำลังบันทึกใบหน้า",
    instruction:
      "กรุณามองตรงไปที่กล้องและอยู่ในตำแหน่งเดิม ขณะระบบกำลังบันทึกใบหน้า",
  },
  SYNC_REQUIRED: {
    title: "ต้องซิงค์สถานะ",
    instruction:
      "พบข้อมูลใบหน้าที่บันทึกไว้แล้ว กรุณาซิงค์สถานะโดยไม่ต้องสแกนใหม่",
  },
  SYNCING: {
    title: "กำลังซิงค์สถานะ",
    instruction: "กำลังซิงค์สถานะการลงทะเบียน กรุณารอสักครู่...",
  },
  SYNC_ERROR: {
    title: "ซิงค์สถานะไม่สำเร็จ",
    instruction:
      "บันทึกข้อมูลใบหน้าแล้ว กรุณาลองซิงค์สถานะอีกครั้งโดยไม่ต้องสแกนใหม่",
  },
  SUCCESS: {
    title: "ลงทะเบียนสำเร็จ",
    instruction: "บันทึกข้อมูลใบหน้าและลงทะเบียนเรียบร้อยแล้ว",
  },
  NO_FACE: {
    title: "ไม่พบใบหน้า",
    instruction:
      "กรุณาจัดใบหน้าให้อยู่ในตำแหน่งที่กล้องมองเห็น ปรับแสงให้เหมาะสม แล้วลองอีกครั้ง",
  },
  MULTIPLE_FACES: {
    title: "ตรวจพบหลายใบหน้า",
    instruction: "กรุณาให้พนักงานที่ลงทะเบียนอยู่หน้ากล้องเพียงคนเดียว",
  },
  BUSY: {
    title: "กล้องกำลังถูกใช้งาน",
    instruction: "มีการใช้งานกล้องอยู่ กรุณาลองอีกครั้งในอีกสักครู่",
  },
  PI_UNAVAILABLE: {
    title: "ไม่สามารถเชื่อมต่อบริการ Pi ได้",
    instruction: "กรุณาตรวจสอบบริการสแกนใบหน้าบนเครื่อง แล้วลองอีกครั้ง",
  },
};

interface EmployeeFaceRegistrationProps {
  session: KioskSession;
  onCancel: () => Promise<void>;
  onSessionEnded: () => void;
  onCompleted: () => void;
}

function EmployeeFaceRegistration({
  session,
  onCancel,
  onSessionEnded,
  onCompleted,
}: EmployeeFaceRegistrationProps) {
  const employee = session.employee;
  const [state, setState] = useState<RegistrationState>("CHECKING");
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const activeRequestRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (employee === null) {
      onSessionEnded();
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
  }, [employee, onSessionEnded]);

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
        onSessionEnded();
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

  async function handleCancel() {
    if (isCancelling) return;
    activeRequestRef.current?.abort();
    setCancelError(null);
    setIsCancelling(true);
    try {
      await onCancel();
    } catch {
      setCancelError(
        "ไม่สามารถยกเลิกการลงทะเบียนใบหน้าได้ กรุณาตรวจสอบการเชื่อมต่อแล้วลองอีกครั้ง",
      );
    } finally {
      setIsCancelling(false);
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
        <div
          className={`face-scan-indicator face-scan-indicator--${
            state === "CAPTURING" ? "scanning" : state.toLowerCase()
          }`}
          aria-hidden="true"
        >
          <span>{state === "SUCCESS" ? "✓" : "◎"}</span>
        </div>
        <h1 id="registration-title">ลงทะเบียนใบหน้า</h1>
        <div
          className="employee-registration-status"
          aria-live="polite"
          aria-busy={busy}
        >
          {CONTENT[state].title && <h2>{CONTENT[state].title}</h2>}
          {CONTENT[state].instruction && <p>{CONTENT[state].instruction}</p>}
          <p className="employee-registration-identity">
            {employee.employeeCode} {employee.name}
          </p>
          {cancelError && (
            <p className="employee-registration-error" role="alert">
              {cancelError}
            </p>
          )}
        </div>
        <div className="employee-registration-actions">
          {(state === "READY" || retryCapture) && (
            <button
              className="employee-registration-submit"
              type="button"
              onClick={() => void capture()}
            >
              {retryCapture ? "ลองสแกนอีกครั้ง" : "เริ่มสแกนใบหน้า"}
            </button>
          )}
          {(state === "SYNC_REQUIRED" || state === "SYNC_ERROR") && (
            <button
              className="employee-registration-submit"
              type="button"
              onClick={() => void syncCompletion()}
            >
              {state === "SYNC_ERROR"
                ? "ลองซิงค์สถานะอีกครั้ง"
                : "ซิงค์สถานะการลงทะเบียน"}
            </button>
          )}
        </div>
        <button
          className="employee-registration-back"
          type="button"
          disabled={isCancelling}
          onClick={() => void handleCancel()}
        >
          {isCancelling ? "กำลังกลับสู่หน้าหลัก..." : "กลับสู่หน้าหลัก"}
        </button>
      </section>
    </main>
  );
}

export default EmployeeFaceRegistration;

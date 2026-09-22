import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  FaceRegistrationError,
  registerEmployeeFace,
} from "../api/face-registration";
import {
  EmployeeValidationError,
  validateEmployeeForFaceRegistration,
} from "../api/employee-auth";
import type { AuthenticatedEmployee } from "../types/employee";

type RegistrationState =
  | "ENTRY"
  | "VALIDATING"
  | "NOT_ELIGIBLE"
  | "BACKEND_UNAVAILABLE"
  | "READY"
  | "CAPTURING"
  | "SUCCESS"
  | "NO_FACE"
  | "MULTIPLE_FACES"
  | "ALREADY_REGISTERED"
  | "BUSY"
  | "PI_UNAVAILABLE";

const STATE_CONTENT: Record<RegistrationState, { title: string; instruction: string }> = {
  ENTRY: {
    title: "Find an employee",
    instruction: "Enter the employee code to verify that the employee exists and is active.",
  },
  VALIDATING: {
    title: "Validating employee",
    instruction: "Checking the employee record with the backend...",
  },
  NOT_ELIGIBLE: {
    title: "Employee not eligible",
    instruction: "The employee code is unknown or the employee is inactive.",
  },
  BACKEND_UNAVAILABLE: {
    title: "Backend unavailable",
    instruction: "Employee validation could not be completed. Check the backend and try again.",
  },
  READY: {
    title: "Ready to register",
    instruction: "Ask the employee to face the camera alone, then start registration.",
  },
  CAPTURING: {
    title: "Capturing face",
    instruction: "Keep one face centered while five stabilized captures are collected.",
  },
  SUCCESS: {
    title: "Registration complete",
    instruction: "The local face template was saved on this Raspberry Pi.",
  },
  NO_FACE: {
    title: "No face detected",
    instruction: "Move into view, improve lighting, and try the capture again.",
  },
  MULTIPLE_FACES: {
    title: "Multiple faces detected",
    instruction: "Only the employee being registered may remain in camera view.",
  },
  ALREADY_REGISTERED: {
    title: "Already registered",
    instruction: "This employee already has a local face template. It was not replaced.",
  },
  BUSY: {
    title: "Camera busy",
    instruction: "Another authentication or registration scan is using the camera. Try again shortly.",
  },
  PI_UNAVAILABLE: {
    title: "Pi service unavailable",
    instruction: "Registration could not reach the local face service. Check it and try again.",
  },
};

interface EmployeeFaceRegistrationProps {
  onCancel: () => void;
}

function EmployeeFaceRegistration({ onCancel }: EmployeeFaceRegistrationProps) {
  const [employeeCode, setEmployeeCode] = useState("");
  const [employee, setEmployee] = useState<AuthenticatedEmployee | null>(null);
  const [registrationState, setRegistrationState] = useState<RegistrationState>("ENTRY");
  const activeRequestRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      activeRequestRef.current?.abort();
    },
    [],
  );

  async function handleValidation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEmployeeCode = employeeCode.trim().toUpperCase();
    if (normalizedEmployeeCode.length === 0) {
      setEmployee(null);
      setRegistrationState("NOT_ELIGIBLE");
      return;
    }

    const controller = new AbortController();
    activeRequestRef.current?.abort();
    activeRequestRef.current = controller;
    setEmployeeCode(normalizedEmployeeCode);
    setEmployee(null);
    setRegistrationState("VALIDATING");

    try {
      const validatedEmployee = await validateEmployeeForFaceRegistration(
        normalizedEmployeeCode,
        controller.signal,
      );
      setEmployee(validatedEmployee);
      setRegistrationState("READY");
    } catch (error: unknown) {
      if (controller.signal.aborted) return;
      setRegistrationState(
        error instanceof EmployeeValidationError && error.rejected
          ? "NOT_ELIGIBLE"
          : "BACKEND_UNAVAILABLE",
      );
    } finally {
      if (activeRequestRef.current === controller) activeRequestRef.current = null;
    }
  }

  async function handleRegistration() {
    if (employee === null) return;
    const controller = new AbortController();
    activeRequestRef.current = controller;
    setRegistrationState("CAPTURING");

    try {
      await registerEmployeeFace(employee.employeeCode, controller.signal);
      setRegistrationState("SUCCESS");
    } catch (error: unknown) {
      if (controller.signal.aborted) return;
      if (error instanceof FaceRegistrationError) {
        setRegistrationState(
          error.status === "UNAVAILABLE" ? "PI_UNAVAILABLE" : error.status,
        );
      } else {
        setRegistrationState("PI_UNAVAILABLE");
      }
    } finally {
      if (activeRequestRef.current === controller) activeRequestRef.current = null;
    }
  }

  function resetEmployee() {
    activeRequestRef.current?.abort();
    activeRequestRef.current = null;
    setEmployee(null);
    setEmployeeCode("");
    setRegistrationState("ENTRY");
  }

  function handleBack() {
    activeRequestRef.current?.abort();
    activeRequestRef.current = null;
    onCancel();
  }

  const content = STATE_CONTENT[registrationState];
  const isValidating = registrationState === "VALIDATING";
  const isCapturing = registrationState === "CAPTURING";
  const canRetryCapture = ["NO_FACE", "MULTIPLE_FACES", "BUSY", "PI_UNAVAILABLE"].includes(
    registrationState,
  );

  return (
    <main className="home-page employee-registration-page">
      <section className="employee-registration-card" aria-labelledby="registration-title">
        <p className="mode-label mode-label--admin">Admin Prototype</p>
        <h1 id="registration-title">Employee Face Registration</h1>

        <div className="employee-registration-status" aria-live="polite" aria-busy={isCapturing}>
          <h2>{content.title}</h2>
          <p>{content.instruction}</p>
          {employee !== null && (
            <p className="employee-registration-identity">
              {employee.name} - {employee.employeeCode}
            </p>
          )}
        </div>

        {employee === null ? (
          <form className="employee-registration-form" onSubmit={(event) => void handleValidation(event)}>
            <label htmlFor="registration-employee-code">Employee code</label>
            <input
              id="registration-employee-code"
              type="text"
              autoComplete="off"
              maxLength={64}
              value={employeeCode}
              disabled={isValidating}
              onChange={(event) => {
                setEmployeeCode(event.target.value);
                if (registrationState !== "ENTRY") setRegistrationState("ENTRY");
              }}
            />
            <button type="submit" disabled={isValidating}>
              {isValidating ? "Validating..." : "Validate Employee"}
            </button>
          </form>
        ) : (
          <div className="employee-registration-actions">
            {(registrationState === "READY" || canRetryCapture) && (
              <button
                className="employee-registration-submit"
                type="button"
                onClick={() => void handleRegistration()}
              >
                {canRetryCapture ? "Try Capture Again" : "Start Face Registration"}
              </button>
            )}
            <button
              className="employee-registration-secondary"
              type="button"
              disabled={isCapturing}
              onClick={resetEmployee}
            >
              Register Another Employee
            </button>
          </div>
        )}

        <button className="employee-registration-back" type="button" onClick={handleBack}>
          Back to Customer Mode
        </button>
      </section>
    </main>
  );
}

export default EmployeeFaceRegistration;

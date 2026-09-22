import { useEffect, useRef, useState } from "react";
import {
  FaceRegistrationError,
  fetchFaceRegistrationStatuses,
  registerEmployeeFace,
} from "../api/face-registration";
import {
  EmployeeValidationError,
  fetchEmployeesForFaceRegistration,
  validateEmployeeForFaceRegistration,
} from "../api/employee-auth";
import type { RegistrationEmployee } from "../types/employee";

type DirectoryState = "LOADING" | "READY" | "EMPTY" | "BACKEND_UNAVAILABLE";
type PiStatusState = "IDLE" | "LOADING" | "READY" | "UNAVAILABLE";
type RegistrationState =
  | "VALIDATING"
  | "INACTIVE"
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
  VALIDATING: {
    title: "Validating employee",
    instruction: "Confirming that this employee is still active before capture...",
  },
  INACTIVE: {
    title: "Inactive employee",
    instruction: "Inactive employees cannot register a face.",
  },
  NOT_ELIGIBLE: {
    title: "Employee not eligible",
    instruction: "The employee is unknown or is no longer active.",
  },
  BACKEND_UNAVAILABLE: {
    title: "Backend unavailable",
    instruction: "Employee validation could not be completed. Try again before capture.",
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
  const [employees, setEmployees] = useState<RegistrationEmployee[]>([]);
  const [directoryState, setDirectoryState] = useState<DirectoryState>("LOADING");
  const [piStatusState, setPiStatusState] = useState<PiStatusState>("IDLE");
  const [registrationStatuses, setRegistrationStatuses] = useState<Record<string, boolean>>({});
  const [selectedEmployee, setSelectedEmployee] = useState<RegistrationEmployee | null>(null);
  const [registrationState, setRegistrationState] = useState<RegistrationState>("VALIDATING");
  const activeRequestRef = useRef<AbortController | null>(null);

  async function loadDirectory() {
    const controller = new AbortController();
    activeRequestRef.current?.abort();
    activeRequestRef.current = controller;
    setDirectoryState("LOADING");
    setPiStatusState("IDLE");
    setRegistrationStatuses({});

    try {
      const loadedEmployees = await fetchEmployeesForFaceRegistration(controller.signal);
      if (controller.signal.aborted) return;
      setEmployees(loadedEmployees);
      if (loadedEmployees.length === 0) {
        setDirectoryState("EMPTY");
        return;
      }

      setDirectoryState("READY");
      setPiStatusState("LOADING");
      try {
        const statuses = await fetchFaceRegistrationStatuses(
          loadedEmployees.map((employee) => employee.employeeCode),
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setRegistrationStatuses(
          Object.fromEntries(
            statuses.map((status) => [status.employeeCode, status.registered]),
          ),
        );
        setPiStatusState("READY");
      } catch {
        if (!controller.signal.aborted) setPiStatusState("UNAVAILABLE");
      }
    } catch {
      if (!controller.signal.aborted) {
        setEmployees([]);
        setDirectoryState("BACKEND_UNAVAILABLE");
      }
    } finally {
      if (activeRequestRef.current === controller) activeRequestRef.current = null;
    }
  }

  useEffect(() => {
    void loadDirectory();
    return () => activeRequestRef.current?.abort();
  }, []);

  async function retryPiStatuses() {
    const controller = new AbortController();
    activeRequestRef.current?.abort();
    activeRequestRef.current = controller;
    setPiStatusState("LOADING");

    try {
      const statuses = await fetchFaceRegistrationStatuses(
        employees.map((employee) => employee.employeeCode),
        controller.signal,
      );
      setRegistrationStatuses(
        Object.fromEntries(statuses.map((status) => [status.employeeCode, status.registered])),
      );
      setPiStatusState("READY");
    } catch {
      if (!controller.signal.aborted) setPiStatusState("UNAVAILABLE");
    } finally {
      if (activeRequestRef.current === controller) activeRequestRef.current = null;
    }
  }

  async function validateSelection(employee: RegistrationEmployee) {
    setSelectedEmployee(employee);
    if (!employee.isActive) {
      setRegistrationState("INACTIVE");
      return;
    }
    if (registrationStatuses[employee.employeeCode] === true) {
      setRegistrationState("ALREADY_REGISTERED");
      return;
    }

    const controller = new AbortController();
    activeRequestRef.current?.abort();
    activeRequestRef.current = controller;
    setRegistrationState("VALIDATING");

    try {
      await validateEmployeeForFaceRegistration(employee.employeeCode, controller.signal);
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
    if (selectedEmployee === null) return;
    const controller = new AbortController();
    activeRequestRef.current = controller;
    setRegistrationState("CAPTURING");

    try {
      await registerEmployeeFace(selectedEmployee.employeeCode, controller.signal);
      setRegistrationStatuses((current) => ({
        ...current,
        [selectedEmployee.employeeCode]: true,
      }));
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

  function chooseAnotherEmployee() {
    activeRequestRef.current?.abort();
    activeRequestRef.current = null;
    setSelectedEmployee(null);
  }

  function handleBack() {
    activeRequestRef.current?.abort();
    activeRequestRef.current = null;
    onCancel();
  }

  const isCapturing = registrationState === "CAPTURING";
  const canRetryCapture = ["NO_FACE", "MULTIPLE_FACES", "BUSY", "PI_UNAVAILABLE"].includes(
    registrationState,
  );

  return (
    <main className="home-page employee-registration-page">
      <section className="employee-registration-card" aria-labelledby="registration-title">
        <p className="mode-label mode-label--admin">Admin Prototype</p>
        <h1 id="registration-title">Employee Face Registration</h1>

        {selectedEmployee === null ? (
          <div className="employee-directory" aria-live="polite">
            <div className="employee-registration-status">
              <h2>Select an employee</h2>
              <p>Choose an existing backend employee to continue.</p>
            </div>

            {directoryState === "LOADING" && <p className="directory-message">Loading employees...</p>}
            {directoryState === "BACKEND_UNAVAILABLE" && (
              <div className="directory-message directory-message--error">
                <p>The employee list is unavailable.</p>
                <button type="button" onClick={() => void loadDirectory()}>Retry</button>
              </div>
            )}
            {directoryState === "EMPTY" && (
              <div className="directory-message">
                <p>No employees are available for registration.</p>
                <button type="button" onClick={() => void loadDirectory()}>Refresh List</button>
              </div>
            )}
            {directoryState === "READY" && (
              <>
                {piStatusState === "LOADING" && (
                  <p className="registration-status-banner">Checking local registration status...</p>
                )}
                {piStatusState === "UNAVAILABLE" && (
                  <div className="registration-status-banner registration-status-banner--warning">
                    <span>Pi registration status is unavailable.</span>
                    <button type="button" onClick={() => void retryPiStatuses()}>Retry Status</button>
                  </div>
                )}
                <div className="employee-directory-list">
                  {employees.map((employee) => {
                    const registered = registrationStatuses[employee.employeeCode];
                    const registrationLabel =
                      piStatusState === "LOADING"
                        ? "Checking..."
                        : registered === true
                          ? "Registered"
                          : registered === false
                            ? "Not registered"
                            : "Status unavailable";
                    return (
                      <button
                        className="employee-directory-item"
                        type="button"
                        key={employee.id}
                        disabled={!employee.isActive || piStatusState === "LOADING"}
                        onClick={() => void validateSelection(employee)}
                      >
                        <span className="employee-directory-identity">
                          <strong>{employee.name}</strong>
                          <span>{employee.employeeCode}</span>
                        </span>
                        <span className="employee-directory-badges">
                          <span className={`employee-state-badge employee-state-badge--${employee.isActive ? "active" : "inactive"}`}>
                            {employee.isActive ? "Active" : "Inactive"}
                          </span>
                          <span className={`registration-state-badge registration-state-badge--${registered === true ? "registered" : registered === false ? "unregistered" : "unknown"}`}>
                            {registrationLabel}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        ) : (
          <>
            <div className="employee-registration-status" aria-live="polite" aria-busy={isCapturing}>
              <h2>{STATE_CONTENT[registrationState].title}</h2>
              <p>{STATE_CONTENT[registrationState].instruction}</p>
              <p className="employee-registration-identity">
                {selectedEmployee.name} - {selectedEmployee.employeeCode}
              </p>
            </div>

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
              {registrationState === "BACKEND_UNAVAILABLE" && (
                <button
                  className="employee-registration-submit"
                  type="button"
                  onClick={() => void validateSelection(selectedEmployee)}
                >
                  Retry Validation
                </button>
              )}
              <button
                className="employee-registration-secondary"
                type="button"
                disabled={isCapturing || registrationState === "VALIDATING"}
                onClick={chooseAnotherEmployee}
              >
                Choose Another Employee
              </button>
            </div>
          </>
        )}

        <button className="employee-registration-back" type="button" onClick={handleBack}>
          Back to Customer Mode
        </button>
      </section>
    </main>
  );
}

export default EmployeeFaceRegistration;

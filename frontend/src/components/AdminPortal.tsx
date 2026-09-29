import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  createEmployee,
  deleteEmployee,
  EmployeeManagementError,
  fetchEmployeesForFaceRegistration,
  updateEmployee,
} from "../api/employee-auth";
import {
  cancelKioskSession,
  fetchCurrentKioskSession,
  startFaceRegistrationSession,
  type KioskSession,
} from "../api/kiosk-session";
import { getPortalSessionState } from "../portal-session-state.mjs";
import type { RegistrationEmployee } from "../types/employee";

interface AdminPortalProps {
  onBack: () => void;
}

const sortEmployees = (employees: RegistrationEmployee[]) =>
  [...employees].sort((a, b) => a.employeeCode.localeCompare(b.employeeCode));

function AdminPortal({ onBack }: AdminPortalProps) {
  const [employees, setEmployees] = useState<RegistrationEmployee[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [name, setName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [editingEmployeeId, setEditingEmployeeId] = useState<number | null>(
    null,
  );
  const [editName, setEditName] = useState("");
  const [deleteConfirmationId, setDeleteConfirmationId] = useState<
    number | null
  >(null);
  const [busyEmployeeIds, setBusyEmployeeIds] = useState<Set<number>>(
    () => new Set(),
  );
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  const [session, setSession] = useState<KioskSession | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [sessionBusy, setSessionBusy] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const requestRef = useRef<AbortController | null>(null);

  const loadEmployees = useCallback(async () => {
    const controller = new AbortController();
    requestRef.current?.abort();
    requestRef.current = controller;
    setIsLoading(true);
    setLoadError(false);
    try {
      setEmployees(
        sortEmployees(
          await fetchEmployeesForFaceRegistration(controller.signal),
        ),
      );
    } catch {
      if (!controller.signal.aborted) setLoadError(true);
    } finally {
      if (!controller.signal.aborted) setIsLoading(false);
      if (requestRef.current === controller) requestRef.current = null;
    }
  }, []);

  useEffect(() => {
    void loadEmployees();
    return () => requestRef.current?.abort();
  }, [loadEmployees]);

  useEffect(() => {
    let stopped = false;
    let timeoutId: number | undefined;
    let controller: AbortController | undefined;
    const poll = async () => {
      controller = new AbortController();
      try {
        const current = await fetchCurrentKioskSession(controller.signal);
        if (!stopped) {
          setSession(current);
          setSessionLoaded(true);
          setSessionError(null);
        }
      } catch {
        if (!stopped) {
          setSessionLoaded(true);
          setSessionError("Kiosk session status is unavailable.");
        }
      } finally {
        if (!stopped) timeoutId = window.setTimeout(poll, 1500);
      }
    };
    void poll();
    return () => {
      stopped = true;
      controller?.abort();
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || isCreating) return;
    setIsCreating(true);
    setMessage(null);
    try {
      const employee = await createEmployee(name);
      setEmployees((current) => sortEmployees([...current, employee]));
      setMessage(
        `Created ${employee.employeeCode} for ${employee.name}. Start face registration separately when ready.`,
      );
      setName("");
    } catch {
      setMessage("Employee creation failed. Check the backend and try again.");
    } finally {
      setIsCreating(false);
    }
  }

  function setEmployeeBusy(employeeId: number, busy: boolean) {
    setBusyEmployeeIds((current) => {
      const next = new Set(current);
      if (busy) next.add(employeeId);
      else next.delete(employeeId);
      return next;
    });
  }

  function setRowError(employeeId: number, error: string | null) {
    setRowErrors((current) => {
      const next = { ...current };
      if (error === null) delete next[employeeId];
      else next[employeeId] = error;
      return next;
    });
  }

  function mutationErrorMessage(error: unknown, fallback: string) {
    return error instanceof EmployeeManagementError ? error.message : fallback;
  }

  function replaceEmployee(updatedEmployee: RegistrationEmployee) {
    setEmployees((current) =>
      sortEmployees(
        current.map((employee) =>
          employee.id === updatedEmployee.id ? updatedEmployee : employee,
        ),
      ),
    );
  }

  function beginEdit(employee: RegistrationEmployee) {
    setDeleteConfirmationId(null);
    setRowError(employee.id, null);
    setEditingEmployeeId(employee.id);
    setEditName(employee.name);
  }

  function cancelEdit() {
    setEditingEmployeeId(null);
    setEditName("");
  }

  async function handleSaveName(employee: RegistrationEmployee) {
    const normalizedName = editName.trim();
    if (!normalizedName || busyEmployeeIds.has(employee.id)) return;
    setEmployeeBusy(employee.id, true);
    setRowError(employee.id, null);
    try {
      replaceEmployee(
        await updateEmployee(employee.id, { name: normalizedName }),
      );
      cancelEdit();
    } catch (error) {
      setRowError(
        employee.id,
        mutationErrorMessage(
          error,
          "Employee name update failed. Please try again.",
        ),
      );
    } finally {
      setEmployeeBusy(employee.id, false);
    }
  }

  async function handleActiveChange(employee: RegistrationEmployee) {
    if (busyEmployeeIds.has(employee.id)) return;
    setEmployeeBusy(employee.id, true);
    setRowError(employee.id, null);
    try {
      replaceEmployee(
        await updateEmployee(employee.id, { isActive: !employee.isActive }),
      );
    } catch (error) {
      setRowError(
        employee.id,
        mutationErrorMessage(
          error,
          "Employee status update failed. Please try again.",
        ),
      );
    } finally {
      setEmployeeBusy(employee.id, false);
    }
  }

  async function handleDelete(employee: RegistrationEmployee) {
    if (busyEmployeeIds.has(employee.id)) return;
    setEmployeeBusy(employee.id, true);
    setRowError(employee.id, null);
    try {
      await deleteEmployee(employee.id);
      setEmployees((current) =>
        current.filter((item) => item.id !== employee.id),
      );
      setDeleteConfirmationId(null);
      if (editingEmployeeId === employee.id) cancelEdit();
    } catch (error) {
      setRowError(
        employee.id,
        mutationErrorMessage(
          error,
          "Employee deletion failed. Please try again.",
        ),
      );
    } finally {
      setEmployeeBusy(employee.id, false);
    }
  }

  async function handleStartFaceRegistration(employee: RegistrationEmployee) {
    if (sessionBusy || session !== null) return;
    setSessionBusy(true);
    setSessionError(null);
    setMessage(null);
    try {
      setSession(await startFaceRegistrationSession(employee.id));
      setMessage(`The kiosk is waiting to register ${employee.employeeCode}.`);
    } catch (error) {
      setSessionError(
        error instanceof Error ? error.message : "Session request failed.",
      );
    } finally {
      setSessionBusy(false);
    }
  }

  async function handleCancelFaceRegistration() {
    if (session?.type !== "FACE_REGISTRATION" || sessionBusy) return;
    setSessionBusy(true);
    setSessionError(null);
    setMessage(null);
    try {
      await cancelKioskSession(session.id);
      setSession(null);
      setMessage("Face-registration session cancelled.");
    } catch (error) {
      setSessionError(
        error instanceof Error ? error.message : "Session request failed.",
      );
    } finally {
      setSessionBusy(false);
    }
  }

  const portalState = getPortalSessionState(session, "FACE_REGISTRATION");
  const secondsRemaining = session
    ? Math.max(
        0,
        Math.ceil((new Date(session.expiresAt).getTime() - now) / 1000),
      )
    : 0;

  return (
    <main className="home-page remote-portal-page admin-portal-page">
      <div className="staff-portal-container">
        <header className="staff-portal-header">
          <div>
            <p className="mode-label mode-label--admin">
              Prototype Admin Portal
            </p>
            <h1>Admin / Employee Management</h1>
            <p>Manage employees and initiate kiosk face registration.</p>
          </div>
          <button type="button" onClick={onBack}>
            Back to Home
          </button>
        </header>

        <section
          className="staff-session-section"
          aria-labelledby="registration-session-title"
        >
          <div className="staff-section-heading">
            <div>
              <h2 id="registration-session-title">Face registration status</h2>
              <p>
                Registration runs locally on the kiosk for the selected active
                employee.
              </p>
            </div>
          </div>

          {portalState === "OWN_SESSION" && session !== null && (
            <div className="staff-active-session" role="status">
              <div>
                <strong>Face registration ACTIVE</strong>
                <p>
                  Kiosk waiting to register {session.employee?.name} ({" "}
                  {session.employee?.employeeCode}).
                </p>
                <span>
                  Expires in {secondsRemaining}s ·{" "}
                  {new Date(session.expiresAt).toLocaleTimeString()}
                </span>
              </div>
              <button
                type="button"
                disabled={sessionBusy}
                onClick={() => void handleCancelFaceRegistration()}
              >
                Cancel
              </button>
            </div>
          )}

          {portalState === "KIOSK_BUSY" && (
            <div className="staff-busy-session" role="status">
              <strong>Kiosk busy</strong>
              <p>
                Another kiosk workflow is active. Face registration can start
                when it finishes or expires.
              </p>
            </div>
          )}

          {portalState === "IDLE" && sessionLoaded && !sessionError && (
            <p className="staff-message">
              No face-registration session is active.
            </p>
          )}
          {sessionError && (
            <p className="staff-message staff-message--error">{sessionError}</p>
          )}
          {message && (
            <p className="staff-message staff-message--success">{message}</p>
          )}
        </section>

        <section
          className="staff-add-employee"
          aria-labelledby="add-employee-title"
        >
          <div>
            <h2 id="add-employee-title">Add Employee</h2>
            <p>
              This creates the employee record only. It does not start face
              registration.
            </p>
          </div>
          <form onSubmit={(event) => void handleCreate(event)}>
            <label htmlFor="admin-employee-name">Employee name</label>
            <div className="staff-add-row">
              <input
                id="admin-employee-name"
                type="text"
                maxLength={120}
                value={name}
                disabled={isCreating}
                onChange={(event) => setName(event.target.value)}
              />
              <button type="submit" disabled={isCreating || !name.trim()}>
                {isCreating ? "Adding..." : "+ Add Employee"}
              </button>
            </div>
          </form>
        </section>

        <section
          className="staff-employee-section"
          aria-labelledby="employee-list-title"
        >
          <div className="staff-section-heading">
            <div>
              <h2 id="employee-list-title">Employee directory</h2>
              <p>
                Face status is workflow metadata and contains no biometric data.
              </p>
            </div>
            <button
              type="button"
              disabled={isLoading}
              onClick={() => void loadEmployees()}
            >
              Refresh
            </button>
          </div>
          {isLoading && <p className="staff-message">Loading employees...</p>}
          {loadError && (
            <div className="staff-message staff-message--error">
              <span>The employee list is unavailable.</span>
              <button type="button" onClick={() => void loadEmployees()}>
                Retry
              </button>
            </div>
          )}
          {!isLoading && !loadError && employees.length === 0 && (
            <p className="staff-message">No employees have been created.</p>
          )}
          {!isLoading && !loadError && employees.length > 0 && (
            <div
              className="staff-employee-table"
              role="table"
              aria-label="Employees"
            >
              <div
                className="staff-employee-row staff-employee-row--header"
                role="row"
              >
                <span>Code</span>
                <span>Name</span>
                <span>Employee</span>
                <span>Face Status</span>
                <span>Actions</span>
              </div>
              {employees.map((employee) => (
                <div
                  className="staff-employee-row"
                  role="row"
                  key={employee.id}
                >
                  <strong>{employee.employeeCode}</strong>
                  <span>
                    {editingEmployeeId === employee.id ? (
                      <label className="admin-edit-name">
                        <span className="sr-only">Employee name</span>
                        <input
                          type="text"
                          maxLength={120}
                          value={editName}
                          disabled={busyEmployeeIds.has(employee.id)}
                          onChange={(event) => setEditName(event.target.value)}
                        />
                      </label>
                    ) : (
                      employee.name
                    )}
                  </span>
                  <span
                    className={
                      employee.isActive ? "staff-active" : "staff-inactive"
                    }
                  >
                    {employee.isActive ? "Active" : "Inactive"}
                  </span>
                  <span
                    className={
                      employee.faceRegistered
                        ? "staff-registered"
                        : "staff-setup-required"
                    }
                  >
                    {employee.faceRegistered
                      ? "Registered"
                      : "Face Setup Required"}
                  </span>
                  <div className="admin-employee-action-cell">
                    {editingEmployeeId === employee.id ? (
                      <div className="admin-employee-actions">
                        <button
                          type="button"
                          disabled={
                            busyEmployeeIds.has(employee.id) || !editName.trim()
                          }
                          onClick={() => void handleSaveName(employee)}
                        >
                          {busyEmployeeIds.has(employee.id)
                            ? "Saving..."
                            : "Save"}
                        </button>
                        <button
                          type="button"
                          disabled={busyEmployeeIds.has(employee.id)}
                          onClick={cancelEdit}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : deleteConfirmationId === employee.id ? (
                      <div className="admin-delete-confirmation">
                        <strong>Delete {employee.employeeCode}?</strong>
                        <span>
                          This permanently removes this unused employee record.
                        </span>
                        <div className="admin-employee-actions">
                          <button
                            className="admin-delete-action"
                            type="button"
                            disabled={busyEmployeeIds.has(employee.id)}
                            onClick={() => void handleDelete(employee)}
                          >
                            {busyEmployeeIds.has(employee.id)
                              ? "Deleting..."
                              : "Confirm Delete"}
                          </button>
                          <button
                            type="button"
                            disabled={busyEmployeeIds.has(employee.id)}
                            onClick={() => setDeleteConfirmationId(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="admin-employee-actions">
                        <button
                          type="button"
                          disabled={busyEmployeeIds.has(employee.id)}
                          onClick={() => beginEdit(employee)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          disabled={busyEmployeeIds.has(employee.id)}
                          onClick={() => void handleActiveChange(employee)}
                        >
                          {busyEmployeeIds.has(employee.id)
                            ? "Updating..."
                            : employee.isActive
                              ? "Deactivate"
                              : "Activate"}
                        </button>
                        <button
                          className="admin-delete-action"
                          type="button"
                          disabled={busyEmployeeIds.has(employee.id)}
                          onClick={() => {
                            setEditingEmployeeId(null);
                            setRowError(employee.id, null);
                            setDeleteConfirmationId(employee.id);
                          }}
                        >
                          Delete
                        </button>
                        {!employee.faceRegistered &&
                          employee.isActive &&
                          portalState === "IDLE" &&
                          sessionLoaded &&
                          !sessionError && (
                            <button
                              className="staff-face-action"
                              type="button"
                              disabled={
                                sessionBusy || busyEmployeeIds.has(employee.id)
                              }
                              onClick={() =>
                                void handleStartFaceRegistration(employee)
                              }
                            >
                              Start Face Registration
                            </button>
                          )}
                      </div>
                    )}
                    {rowErrors[employee.id] && (
                      <span className="admin-row-error" role="alert">
                        {rowErrors[employee.id]}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

export default AdminPortal;

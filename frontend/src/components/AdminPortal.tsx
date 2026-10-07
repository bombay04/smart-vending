import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  createEmployee,
  EmployeeManagementError,
  fetchEmployeesForFaceRegistration,
  offboardEmployee,
  startEmployeeDraftDelete,
  updateEmployee,
} from "../api/employee-auth";
import {
  cancelKioskSession,
  fetchCurrentKioskSession,
  KioskSessionRequestError,
  startFaceRegistrationSession,
  type KioskSession,
} from "../api/kiosk-session";
import { getPortalSessionState } from "../portal-session-state.mjs";
import {
  isDuplicateEmployeeName,
  isEmployeeNameCharacterValid,
  normalizeEmployeeNameForComparison,
} from "../employee-name.mjs";
import { didKioskSessionEnd } from "../kiosk-session-flow.mjs";
import type { RegistrationEmployee } from "../types/employee";

const sortEmployees = (employees: RegistrationEmployee[]) =>
  [...employees].sort((a, b) => a.employeeCode.localeCompare(b.employeeCode));

const SUCCESS_MODAL_MS = 2000;
const STALE_EMPLOYEE_MODAL_MS = 2000;
const KIOSK_BUSY_MODAL_MS = 5000;
const CLEANUP_RESULT_MODAL_MS = 5000;
const EMPLOYEE_NAME_INVALID_CODE = "EMPLOYEE_NAME_INVALID";
const EMPLOYEE_NAME_CONFLICT_CODE = "EMPLOYEE_NAME_CONFLICT";
const EMPLOYEE_OFFBOARDED_CODE = "EMPLOYEE_OFFBOARDED";
const INVALID_EMPLOYEE_NAME_MESSAGE = "ชื่อพนักงานมีอักขระที่ไม่รองรับ";
const DUPLICATE_EMPLOYEE_NAME_MESSAGE = "มีชื่อพนักงานนี้อยู่ในระบบแล้ว";

type TimedModal =
  | { type: "EMPLOYEE_CREATED" }
  | { type: "STALE_EMPLOYEE" }
  | { type: "KIOSK_BUSY" }
  | {
      type: "CLEANUP_RESULT";
      tone: "SUCCESS" | "WARNING";
      title: string;
      body: string;
    };

function SuccessCheckIcon() {
  return (
    <svg
      className="admin-success-check-icon"
      viewBox="0 0 64 64"
      focusable="false"
    >
      <circle cx="32" cy="32" r="32" />
      <path d="M15 32.5 26 44l23-25" />
    </svg>
  );
}

function AdminPortal() {
  const [employees, setEmployees] = useState<RegistrationEmployee[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [name, setName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [invalidCharacterName, setInvalidCharacterName] = useState<string | null>(null);
  const [conflictingName, setConflictingName] = useState<string | null>(null);
  const [timedModal, setTimedModal] = useState<TimedModal | null>(null);
  const [editingEmployeeId, setEditingEmployeeId] = useState<number | null>(
    null,
  );
  const [editName, setEditName] = useState("");
  const [deleteConfirmationId, setDeleteConfirmationId] = useState<
    number | null
  >(null);
  const [offboardConfirmationId, setOffboardConfirmationId] = useState<
    number | null
  >(null);
  const [busyEmployeeIds, setBusyEmployeeIds] = useState<Set<number>>(
    () => new Set(),
  );
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  const [session, setSession] = useState<KioskSession | null>(null);
  const [sessionBusy, setSessionBusy] = useState(false);
  const [faceSessionError, setFaceSessionError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const requestRef = useRef<AbortController | null>(null);
  const previousSessionRef = useRef<KioskSession | null>(null);
  const modalTimerRef = useRef<number | null>(null);

  const dismissTimedModal = useCallback(() => {
    if (modalTimerRef.current !== null) {
      window.clearTimeout(modalTimerRef.current);
      modalTimerRef.current = null;
    }
    setTimedModal(null);
  }, []);

  const showTimedModal = useCallback(
    (nextModal: TimedModal, durationMs: number) => {
      dismissTimedModal();
      setTimedModal(nextModal);
      modalTimerRef.current = window.setTimeout(() => {
        modalTimerRef.current = null;
        setTimedModal(null);
      }, durationMs);
    },
    [dismissTimedModal],
  );

  useEffect(
    () => () => {
      if (modalTimerRef.current !== null) {
        window.clearTimeout(modalTimerRef.current);
      }
    },
    [],
  );

  const loadEmployees = useCallback(async () => {
    const controller = new AbortController();
    requestRef.current?.abort();
    requestRef.current = controller;
    setIsLoading(true);
    setLoadError(false);
    try {
      const loadedEmployees = sortEmployees(
        await fetchEmployeesForFaceRegistration(controller.signal),
      );
      setEmployees(loadedEmployees);
      return loadedEmployees;
    } catch {
      if (!controller.signal.aborted) setLoadError(true);
      return null;
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
          const previous = previousSessionRef.current;
          if (
            didKioskSessionEnd(previous, current, "FACE_REGISTRATION")
          ) {
            await loadEmployees();
          }
          if (
            current === null &&
            (previous?.type === "EMPLOYEE_DRAFT_DELETE" ||
              previous?.type === "EMPLOYEE_OFFBOARDING")
          ) {
            const refreshedEmployees = await loadEmployees();
            const refreshedEmployee = refreshedEmployees?.find(
              (employee) => employee.id === previous.employeeId,
            );
            if (
              previous.type === "EMPLOYEE_DRAFT_DELETE" &&
              refreshedEmployees === null
            ) {
              showTimedModal(
                {
                  type: "CLEANUP_RESULT",
                  tone: "WARNING",
                  title: "ไม่สามารถยืนยันผลการดำเนินการได้",
                  body: "กรุณารีเฟรชรายชื่อพนักงานเพื่อตรวจสอบผลอีกครั้ง",
                },
                CLEANUP_RESULT_MODAL_MS,
              );
            } else if (
              previous.type === "EMPLOYEE_DRAFT_DELETE" &&
              refreshedEmployee?.faceRegistered
            ) {
              showTimedModal(
                {
                  type: "CLEANUP_RESULT",
                  tone: "WARNING",
                  title: "ไม่สามารถลบ Draft ได้",
                  body:
                    "ตรวจพบข้อมูลใบหน้าของพนักงาน ระบบเก็บข้อมูลพนักงานไว้เพื่อรักษาประวัติการใช้งาน",
                },
                CLEANUP_RESULT_MODAL_MS,
              );
            } else if (
              previous.type === "EMPLOYEE_DRAFT_DELETE" &&
              refreshedEmployee === undefined
            ) {
              showTimedModal(
                {
                  type: "CLEANUP_RESULT",
                  tone: "SUCCESS",
                  title: "ลบแบบร่างสำเร็จ",
                  body: `${previous.employee?.employeeCode ?? "พนักงาน"} ถูกลบออกจากระบบแล้ว`,
                },
                SUCCESS_MODAL_MS,
              );
            } else if (
              previous.type === "EMPLOYEE_OFFBOARDING" &&
              refreshedEmployee === undefined
            ) {
              showTimedModal(
                {
                  type: "CLEANUP_RESULT",
                  tone: "SUCCESS",
                  title: "นำพนักงานออกจากระบบสำเร็จ",
                  body: `${previous.employee?.employeeCode ?? "พนักงาน"} ถูกนำออกจากระบบแล้ว`,
                },
                SUCCESS_MODAL_MS,
              );
            } else if (previous.type === "EMPLOYEE_DRAFT_DELETE") {
              showTimedModal(
                {
                  type: "CLEANUP_RESULT",
                  tone: "WARNING",
                  title: "ไม่สามารถลบข้อมูลพนักงานได้",
                  body:
                    "สถานะพนักงานมีการเปลี่ยนแปลงระหว่างการตรวจสอบ กรุณาตรวจสอบข้อมูลอีกครั้ง",
                },
                CLEANUP_RESULT_MODAL_MS,
              );
            }
          }
          previousSessionRef.current = current;
          setSession(current);
          if (current?.type !== "FACE_REGISTRATION") {
            setFaceSessionError(null);
          }
        }
      } catch {
        // Keep the last authoritative session while polling retries.
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
  }, [loadEmployees, showTimedModal]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const normalizedInputName = normalizeEmployeeNameForComparison(name);
  const hasInvalidCharacters =
    (normalizedInputName.length > 0 && !isEmployeeNameCharacterValid(name)) ||
    (normalizedInputName.length > 0 && invalidCharacterName === normalizedInputName);
  const hasDuplicateName =
    isDuplicateEmployeeName(name, employees) ||
    (normalizedInputName.length > 0 && conflictingName === normalizedInputName);
  const employeeNameError = hasInvalidCharacters
    ? INVALID_EMPLOYEE_NAME_MESSAGE
    : hasDuplicateName
      ? DUPLICATE_EMPLOYEE_NAME_MESSAGE
      : null;

  function handleNameChange(nextName: string) {
    setName(nextName);
    setCreateError(null);
    const normalizedNextName = normalizeEmployeeNameForComparison(nextName);
    if (normalizedNextName !== invalidCharacterName) {
      setInvalidCharacterName(null);
    }
    if (normalizedNextName !== conflictingName) {
      setConflictingName(null);
    }
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || isCreating || employeeNameError !== null) return;
    setIsCreating(true);
    setCreateError(null);
    try {
      const employee = await createEmployee(name);
      setEmployees((current) => sortEmployees([...current, employee]));
      showTimedModal({ type: "EMPLOYEE_CREATED" }, SUCCESS_MODAL_MS);
      setName("");
    } catch (error) {
      if (
        error instanceof EmployeeManagementError &&
        error.status === 400 &&
        error.code === EMPLOYEE_NAME_INVALID_CODE
      ) {
        setInvalidCharacterName(normalizeEmployeeNameForComparison(name));
      } else if (
        error instanceof EmployeeManagementError &&
        error.status === 409 &&
        error.code === EMPLOYEE_NAME_CONFLICT_CODE
      ) {
        setConflictingName(normalizeEmployeeNameForComparison(name));
      } else {
        setCreateError("Employee creation failed. Check the backend and try again.");
      }
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

  const isAuthoritativeStaleEmployeeError = (error: unknown) =>
    (error instanceof EmployeeManagementError ||
      error instanceof KioskSessionRequestError) &&
    (error.status === 404 ||
      (error.status === 409 && error.code === EMPLOYEE_OFFBOARDED_CODE));

  async function reconcileStaleEmployee(employeeId: number) {
    setRowError(employeeId, null);
    setEmployees((current) =>
      current.filter((employee) => employee.id !== employeeId),
    );
    if (editingEmployeeId === employeeId) cancelEdit();
    setDeleteConfirmationId(null);
    setOffboardConfirmationId(null);
    await loadEmployees();
    showTimedModal({ type: "STALE_EMPLOYEE" }, STALE_EMPLOYEE_MODAL_MS);
  }

  function replaceEmployee(updatedEmployee: RegistrationEmployee) {
    setEmployees((current) =>
      sortEmployees(
        current.map((employee) =>
          employee.id === updatedEmployee.id
            ? { ...employee, ...updatedEmployee }
            : employee,
        ),
      ),
    );
  }

  function beginEdit(employee: RegistrationEmployee) {
    setDeleteConfirmationId(null);
    setOffboardConfirmationId(null);
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
      const updated = await updateEmployee(employee.id, {
        name: normalizedName,
      });
      replaceEmployee({
        ...updated,
        canDeleteDraft: employee.canDeleteDraft,
        activeCleanupType: employee.activeCleanupType,
      });
      cancelEdit();
    } catch (error) {
      if (isAuthoritativeStaleEmployeeError(error)) {
        await reconcileStaleEmployee(employee.id);
      } else {
        setRowError(
          employee.id,
          mutationErrorMessage(
            error,
            "Employee name update failed. Please try again.",
          ),
        );
      }
    } finally {
      setEmployeeBusy(employee.id, false);
    }
  }

  async function handleActiveChange(employee: RegistrationEmployee) {
    if (busyEmployeeIds.has(employee.id)) return;
    setEmployeeBusy(employee.id, true);
    setRowError(employee.id, null);
    try {
      const updated = await updateEmployee(employee.id, {
        isActive: !employee.isActive,
      });
      replaceEmployee({
        ...updated,
        canDeleteDraft: employee.canDeleteDraft,
        activeCleanupType: employee.activeCleanupType,
      });
    } catch (error) {
      if (isAuthoritativeStaleEmployeeError(error)) {
        await reconcileStaleEmployee(employee.id);
      } else {
        setRowError(
          employee.id,
          mutationErrorMessage(
            error,
            "Employee status update failed. Please try again.",
          ),
        );
      }
    } finally {
      setEmployeeBusy(employee.id, false);
    }
  }

  async function handleLifecycleAction(
    employee: RegistrationEmployee,
    action: "EMPLOYEE_DRAFT_DELETE" | "EMPLOYEE_OFFBOARDING",
  ) {
    if (busyEmployeeIds.has(employee.id) || session !== null) return;
    setEmployeeBusy(employee.id, true);
    setRowError(employee.id, null);
    dismissTimedModal();
    try {
      const cleanupSession =
        action === "EMPLOYEE_DRAFT_DELETE"
          ? await startEmployeeDraftDelete(employee.id)
          : await offboardEmployee(employee.id);
      setSession(cleanupSession);
      previousSessionRef.current = cleanupSession;
      setEmployees((current) =>
        current.map((item) =>
          item.id === employee.id
            ? {
                ...item,
                isActive:
                  action === "EMPLOYEE_OFFBOARDING" ? false : item.isActive,
                activeCleanupType: action,
              }
            : item,
        ),
      );
      setDeleteConfirmationId(null);
      setOffboardConfirmationId(null);
    } catch (error) {
      if (isAuthoritativeStaleEmployeeError(error)) {
        await reconcileStaleEmployee(employee.id);
      } else {
        setRowError(
          employee.id,
          mutationErrorMessage(
            error,
            action === "EMPLOYEE_DRAFT_DELETE"
              ? "Draft-delete verification could not start."
              : "Offboarding could not start.",
          ),
        );
      }
    } finally {
      setEmployeeBusy(employee.id, false);
    }
  }

  async function handleStartFaceRegistration(employee: RegistrationEmployee) {
    if (sessionBusy) return;
    setSessionBusy(true);
    setFaceSessionError(null);
    dismissTimedModal();
    setRowError(employee.id, null);
    try {
      const registrationSession = await startFaceRegistrationSession(employee.id);
      previousSessionRef.current = registrationSession;
      setSession(registrationSession);
    } catch (error) {
      if (isAuthoritativeStaleEmployeeError(error)) {
        await reconcileStaleEmployee(employee.id);
      } else if (
        error instanceof KioskSessionRequestError &&
        error.status === 409 &&
        error.message === "Another staff session is already active for this kiosk."
      ) {
        showTimedModal({ type: "KIOSK_BUSY" }, KIOSK_BUSY_MODAL_MS);
      } else {
        setRowError(
          employee.id,
          error instanceof Error ? error.message : "Session request failed.",
        );
      }
    } finally {
      setSessionBusy(false);
    }
  }

  async function handleCancelFaceRegistration() {
    if (session?.type !== "FACE_REGISTRATION" || sessionBusy) return;
    setSessionBusy(true);
    setFaceSessionError(null);
    try {
      await cancelKioskSession(session.id);
      setSession(null);
    } catch (error) {
      setFaceSessionError(
        error instanceof Error ? error.message : "Session request failed.",
      );
    } finally {
      setSessionBusy(false);
    }
  }

  const portalState = getPortalSessionState(session, "FACE_REGISTRATION");
  useEffect(() => {
    if (portalState === "OWN_SESSION") dismissTimedModal();
  }, [dismissTimedModal, portalState]);

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
            <h1>ระบบจัดการพนักงาน</h1>
          </div>
        </header>

        <section
          className="staff-add-employee"
          aria-labelledby="add-employee-title"
        >
          <div>
            <h2 id="add-employee-title">เพิ่มพนักงาน</h2>
          </div>
          <form onSubmit={(event) => void handleCreate(event)}>
            <label htmlFor="admin-employee-name">กรอกชื่อพนักงาน</label>
            <div className="staff-add-row">
              <div className="staff-add-name-field">
                <input
                  id="admin-employee-name"
                  type="text"
                  maxLength={120}
                  value={name}
                  disabled={isCreating}
                  aria-invalid={employeeNameError !== null}
                  aria-describedby={
                    employeeNameError !== null
                      ? "admin-employee-name-error"
                      : undefined
                  }
                  onChange={(event) => handleNameChange(event.target.value)}
                />
                {employeeNameError !== null && (
                  <p
                    id="admin-employee-name-error"
                    className="staff-inline-error"
                    role="alert"
                  >
                    {employeeNameError}
                  </p>
                )}
              </div>
              <button
                type="submit"
                disabled={
                  isCreating || !name.trim() || employeeNameError !== null
                }
              >
                {isCreating ? "Adding..." : "+ เพิ่มพนักงาน"}
              </button>
            </div>
          </form>
          {createError && (
            <p className="staff-message staff-message--error" role="alert">
              {createError}
            </p>
          )}
        </section>

        <section
          className="staff-employee-section"
          aria-labelledby="employee-list-title"
        >
          <div className="staff-section-heading">
            <div>
              <h2 id="employee-list-title">รายชื่อพนักงาน</h2>
            </div>
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
                <span>รหัสพนักงาน</span>
                <span>ชื่อ-นามสกุล</span>
                <span>สถานะ</span>
                <span>สถานะใบหน้า</span>
                <span>การดำเนินการ</span>
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
                        <span className="sr-only">กรอกชื่อพนักงาน</span>
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
                    {employee.isActive ? "ใช้งานอยู่" : "ปิดใช้งาน"}
                  </span>
                  <span
                    className={
                      employee.faceRegistered
                        ? "staff-registered"
                        : "staff-setup-required"
                    }
                  >
                    {employee.faceRegistered
                      ? "ลงทะเบียนแล้ว"
                      : "ต้องลงทะเบียนใบหน้า"}
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
                            : "บันทึก"}
                        </button>
                        <button
                          type="button"
                          disabled={busyEmployeeIds.has(employee.id)}
                          onClick={cancelEdit}
                        >
                          ยกเลิก
                        </button>
                      </div>
                    ) : deleteConfirmationId === employee.id ? (
                      <div className="admin-delete-confirmation">
                        <div className="admin-employee-actions">
                          <button
                            className="admin-delete-action"
                            type="button"
                            disabled={busyEmployeeIds.has(employee.id)}
                            onClick={() =>
                              void handleLifecycleAction(
                                employee,
                                "EMPLOYEE_DRAFT_DELETE",
                              )
                            }
                          >
                            {busyEmployeeIds.has(employee.id)
                              ? "Deleting..."
                              : "ยืนยันการลบแบบร่าง"}
                          </button>
                          <button
                            type="button"
                            disabled={busyEmployeeIds.has(employee.id)}
                            onClick={() => setDeleteConfirmationId(null)}
                          >
                            ยกเลิก
                          </button>
                        </div>
                      </div>
                    ) : offboardConfirmationId === employee.id ? (
                      <div className="admin-delete-confirmation">
                        <div className="admin-employee-actions">
                          <button
                            className="admin-delete-action"
                            type="button"
                            disabled={busyEmployeeIds.has(employee.id)}
                            onClick={() =>
                              void handleLifecycleAction(
                                employee,
                                "EMPLOYEE_OFFBOARDING",
                              )
                            }
                          >
                            {busyEmployeeIds.has(employee.id)
                              ? "Starting..."
                              : "ยืนยันการนำออก"}
                          </button>
                          <button
                            type="button"
                            disabled={busyEmployeeIds.has(employee.id)}
                            onClick={() => setOffboardConfirmationId(null)}
                          >
                            ยกเลิก
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div
                        className={`admin-employee-actions${
                          employee.canDeleteDraft
                            ? " admin-employee-actions--draft"
                            : ""
                        }`}
                      >
                        <button
                          type="button"
                          disabled={
                            busyEmployeeIds.has(employee.id) ||
                            employee.activeCleanupType !== null
                          }
                          onClick={() => beginEdit(employee)}
                        >
                          แก้ไข
                        </button>
                        {!employee.canDeleteDraft && (
                          <>
                            <button
                              type="button"
                              disabled={
                                busyEmployeeIds.has(employee.id) ||
                                employee.activeCleanupType !== null
                              }
                              title="Temporarily disable access. Face registration is retained."
                              onClick={() => void handleActiveChange(employee)}
                            >
                              {busyEmployeeIds.has(employee.id)
                                ? "Updating..."
                                : employee.isActive
                                  ? "ปิดใช้งาน"
                                  : "เปิดใช้งาน"}
                            </button>
                            <button
                              className="admin-delete-action"
                              type="button"
                              disabled={
                                busyEmployeeIds.has(employee.id) ||
                                employee.activeCleanupType !== null ||
                                session !== null
                              }
                              onClick={() => {
                                setEditingEmployeeId(null);
                                setDeleteConfirmationId(null);
                                setRowError(employee.id, null);
                                setOffboardConfirmationId(employee.id);
                              }}
                            >
                              นำออกจากระบบ
                            </button>
                          </>
                        )}
                        {employee.canDeleteDraft && (
                          <button
                            className="admin-delete-action"
                            type="button"
                            disabled={
                              busyEmployeeIds.has(employee.id) ||
                              employee.activeCleanupType !== null ||
                              session !== null
                            }
                            title="Permanently delete this unused employee after kiosk verification."
                            onClick={() => {
                              setEditingEmployeeId(null);
                              setOffboardConfirmationId(null);
                              setRowError(employee.id, null);
                              setDeleteConfirmationId(employee.id);
                            }}
                          >
                            ลบแบบร่าง
                          </button>
                        )}
                        {!employee.faceRegistered &&
                          employee.isActive &&
                          employee.activeCleanupType === null && (
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
                              เริ่มลงทะเบียนใบหน้า
                            </button>
                          )}
                      </div>
                    )}
                    {employee.activeCleanupType === "EMPLOYEE_OFFBOARDING" && (
                      <span className="admin-row-status" role="status">
                        Waiting for kiosk biometric cleanup
                      </span>
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

      {timedModal?.type === "EMPLOYEE_CREATED" && (
        <div className="admin-modal-backdrop">
          <section
            className="admin-feedback-modal admin-feedback-modal--success"
            role="dialog"
            aria-modal="true"
            aria-labelledby="employee-created-modal-title"
          >
            <div className="admin-feedback-modal-icon" aria-hidden="true">
              <SuccessCheckIcon />
            </div>
            <h2 id="employee-created-modal-title">เพิ่มพนักงานสำเร็จ</h2>
          </section>
        </div>
      )}

      {timedModal?.type === "STALE_EMPLOYEE" && (
        <div className="admin-modal-backdrop">
          <section
            className="admin-feedback-modal admin-feedback-modal--info"
            role="dialog"
            aria-modal="true"
            aria-labelledby="stale-employee-modal-title"
          >
            <div className="admin-feedback-modal-icon" aria-hidden="true">
              i
            </div>
            <h2 id="stale-employee-modal-title">
              ข้อมูลพนักงานมีการเปลี่ยนแปลง
            </h2>
          </section>
        </div>
      )}

      {timedModal?.type === "KIOSK_BUSY" && (
        <div className="admin-modal-backdrop">
          <section
            className="admin-feedback-modal admin-feedback-modal--busy"
            role="dialog"
            aria-modal="true"
            aria-labelledby="kiosk-busy-modal-title"
            aria-describedby="kiosk-busy-modal-description"
          >
            <div className="admin-feedback-modal-icon" aria-hidden="true">
              !
            </div>
            <h2 id="kiosk-busy-modal-title">เครื่องกำลังถูกใช้งาน</h2>
            <p id="kiosk-busy-modal-description">
              ไม่สามารถเริ่มลงทะเบียนใบหน้าได้ในขณะนี้
            </p>
            <button type="button" onClick={dismissTimedModal}>
              ตกลง
            </button>
          </section>
        </div>
      )}

      {timedModal?.type === "CLEANUP_RESULT" && (
        <div className="admin-modal-backdrop">
          <section
            className={`admin-feedback-modal admin-feedback-modal--${
              timedModal.tone === "SUCCESS" ? "success" : "warning"
            }`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="cleanup-result-modal-title"
            aria-describedby={
              timedModal.tone === "WARNING"
                ? "cleanup-result-modal-description"
                : undefined
            }
          >
            <div className="admin-feedback-modal-icon" aria-hidden="true">
              {timedModal.tone === "SUCCESS" ? <SuccessCheckIcon /> : "!"}
            </div>
            <h2 id="cleanup-result-modal-title">{timedModal.title}</h2>
            {timedModal.tone === "WARNING" && (
              <p id="cleanup-result-modal-description">{timedModal.body}</p>
            )}
          </section>
        </div>
      )}

      {portalState === "OWN_SESSION" && session !== null && (
          <div className="admin-modal-backdrop">
            <section
              className="admin-face-registration-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="admin-face-registration-modal-title"
            >
              <div className="staff-restock-modal-icon" aria-hidden="true">
                ◉
              </div>
              <h2 id="admin-face-registration-modal-title">
                กำลังลงทะเบียนใบหน้า
              </h2>
              <p className="admin-feedback-modal-identity">
                {session.employee?.employeeCode}
                {session.employee?.name ? ` ${session.employee.name}` : ""}
              </p>
              <p className="admin-face-registration-countdown" role="timer">
                หมดอายุใน {secondsRemaining} วินาที
              </p>
              {faceSessionError && (
                <p className="admin-face-registration-error" role="alert">
                  {faceSessionError}
                </p>
              )}
              <div className="admin-face-registration-actions">
                <button
                  className="admin-face-registration-cancel"
                  type="button"
                  disabled={sessionBusy}
                  onClick={() => void handleCancelFaceRegistration()}
                >
                  {sessionBusy
                    ? "กำลังยกเลิก..."
                    : "ยกเลิกการลงทะเบียน"}
                </button>
              </div>
            </section>
          </div>
        )}
    </main>
  );
}

export default AdminPortal;

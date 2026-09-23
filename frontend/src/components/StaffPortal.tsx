import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  createEmployee,
  fetchEmployeesForFaceRegistration,
} from "../api/employee-auth";
import type { RegistrationEmployee } from "../types/employee";

interface StaffPortalProps {
  onBack: () => void;
}

function sortEmployees(employees: RegistrationEmployee[]): RegistrationEmployee[] {
  return [...employees].sort((first, second) =>
    first.employeeCode.localeCompare(second.employeeCode),
  );
}

function StaffPortal({ onBack }: StaffPortalProps) {
  const [employees, setEmployees] = useState<RegistrationEmployee[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [name, setName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdEmployee, setCreatedEmployee] = useState<RegistrationEmployee | null>(null);
  const requestRef = useRef<AbortController | null>(null);

  async function loadEmployees() {
    const controller = new AbortController();
    requestRef.current?.abort();
    requestRef.current = controller;
    setIsLoading(true);
    setLoadError(false);
    try {
      setEmployees(sortEmployees(await fetchEmployeesForFaceRegistration(controller.signal)));
    } catch {
      if (!controller.signal.aborted) setLoadError(true);
    } finally {
      if (!controller.signal.aborted) setIsLoading(false);
      if (requestRef.current === controller) requestRef.current = null;
    }
  }

  useEffect(() => {
    void loadEmployees();
    return () => requestRef.current?.abort();
  }, []);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (name.trim().length === 0 || isCreating || isLoading) return;

    const controller = new AbortController();
    requestRef.current = controller;
    setIsCreating(true);
    setCreateError(null);
    setCreatedEmployee(null);
    try {
      const employee = await createEmployee(name, controller.signal);
      setEmployees((current) => sortEmployees([...current, employee]));
      setCreatedEmployee(employee);
      setName("");
    } catch {
      if (!controller.signal.aborted) {
        setCreateError("Employee creation failed. Check the backend and try again.");
      }
    } finally {
      if (!controller.signal.aborted) setIsCreating(false);
      if (requestRef.current === controller) requestRef.current = null;
    }
  }

  return (
    <main className="home-page staff-portal-page">
      <div className="staff-portal-container">
        <header className="staff-portal-header">
          <div>
            <p className="mode-label mode-label--admin">Prototype Staff Portal</p>
            <h1>Employee Management</h1>
            <p>Manage employee records and review face-setup status.</p>
          </div>
          <button type="button" onClick={onBack}>Back to Home</button>
        </header>

        <section className="staff-add-employee" aria-labelledby="add-employee-title">
          <div>
            <h2 id="add-employee-title">Add Employee</h2>
            <p>The backend assigns the next employee code automatically.</p>
          </div>
          <form onSubmit={(event) => void handleCreate(event)}>
            <label htmlFor="staff-employee-name">Employee name</label>
            <div className="staff-add-row">
              <input
                id="staff-employee-name"
                type="text"
                maxLength={120}
                value={name}
                disabled={isCreating || isLoading}
                onChange={(event) => setName(event.target.value)}
              />
              <button
                type="submit"
                disabled={isCreating || isLoading || name.trim().length === 0}
              >
                {isCreating ? "Adding..." : "+ Add Employee"}
              </button>
            </div>
          </form>
          {createError && <p className="staff-message staff-message--error">{createError}</p>}
          {createdEmployee && (
            <p className="staff-message staff-message--success">
              Created {createdEmployee.employeeCode} for {createdEmployee.name}. Face setup is required at the vending machine.
            </p>
          )}
        </section>

        <section className="staff-employee-section" aria-labelledby="employee-list-title">
          <div className="staff-section-heading">
            <div>
              <h2 id="employee-list-title">Employees</h2>
              <p>Face status is non-biometric backend metadata reported after Pi enrollment.</p>
            </div>
            <button
              type="button"
              disabled={isLoading || isCreating}
              onClick={() => void loadEmployees()}
            >
              Refresh
            </button>
          </div>

          {isLoading && <p className="staff-message">Loading employees...</p>}
          {loadError && (
            <div className="staff-message staff-message--error">
              <span>The employee list is unavailable.</span>
              <button type="button" onClick={() => void loadEmployees()}>Retry</button>
            </div>
          )}
          {!isLoading && !loadError && employees.length === 0 && (
            <p className="staff-message">No employees have been created.</p>
          )}
          {!isLoading && !loadError && employees.length > 0 && (
            <div className="staff-employee-table" role="table" aria-label="Employees">
              <div className="staff-employee-row staff-employee-row--header" role="row">
                <span role="columnheader">Code</span>
                <span role="columnheader">Name</span>
                <span role="columnheader">Employee</span>
                <span role="columnheader">Face Status</span>
              </div>
              {employees.map((employee) => (
                <div className="staff-employee-row" role="row" key={employee.id}>
                  <strong role="cell">{employee.employeeCode}</strong>
                  <span role="cell">{employee.name}</span>
                  <span role="cell" className={employee.isActive ? "staff-active" : "staff-inactive"}>
                    {employee.isActive ? "Active" : "Inactive"}
                  </span>
                  <span role="cell" className={employee.faceRegistered ? "staff-registered" : "staff-setup-required"}>
                    {employee.faceRegistered ? "Registered" : "Face Setup Required"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

export default StaffPortal;

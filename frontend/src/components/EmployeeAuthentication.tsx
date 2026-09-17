import { type FormEvent, useEffect, useRef, useState } from "react";
import { authenticateMockEmployee } from "../api/employee-auth";
import type { AuthenticatedEmployee } from "../types/employee";

interface EmployeeAuthenticationProps {
  onAuthenticated: (employee: AuthenticatedEmployee) => void;
  onCancel: () => void;
}

function EmployeeAuthentication({ onAuthenticated, onCancel }: EmployeeAuthenticationProps) {
  const [employeeCode, setEmployeeCode] = useState("");
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [authenticationError, setAuthenticationError] = useState<string | null>(null);
  const activeRequestRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      activeRequestRef.current?.abort();
    },
    [],
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isAuthenticating || employeeCode.trim().length === 0) {
      return;
    }

    const requestController = new AbortController();
    activeRequestRef.current = requestController;
    setIsAuthenticating(true);
    setAuthenticationError(null);

    try {
      const employee = await authenticateMockEmployee(employeeCode, requestController.signal);
      onAuthenticated(employee);
    } catch (error: unknown) {
      if (!requestController.signal.aborted) {
        setAuthenticationError(
          error instanceof Error ? error.message : "Employee authentication failed.",
        );
        setIsAuthenticating(false);
      }
    } finally {
      if (activeRequestRef.current === requestController) {
        activeRequestRef.current = null;
      }
    }
  }

  function handleCancel() {
    activeRequestRef.current?.abort();
    onCancel();
  }

  return (
    <main className="home-page employee-auth-page">
      <section className="employee-auth-card" aria-labelledby="employee-auth-title">
        <p className="mode-label mode-label--employee">Employee Mode</p>
        <h1 id="employee-auth-title">Employee Authentication</h1>
        <p className="employee-auth-instruction">
          Enter your employee code to continue to Restock Mode.
        </p>

        <form className="employee-auth-form" onSubmit={handleSubmit}>
          <label htmlFor="employee-code">Employee code</label>
          <input
            id="employee-code"
            name="employeeCode"
            type="text"
            value={employeeCode}
            disabled={isAuthenticating}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            enterKeyHint="done"
            onChange={(event) => setEmployeeCode(event.target.value)}
            aria-describedby={authenticationError ? "employee-auth-error" : undefined}
          />

          {authenticationError && (
            <p
              id="employee-auth-error"
              className="employee-auth-error"
              role="alert"
            >
              {authenticationError}
            </p>
          )}

          <button
            className="employee-auth-submit"
            type="submit"
            disabled={isAuthenticating || employeeCode.trim().length === 0}
          >
            {isAuthenticating ? "Authenticating..." : "Authenticate"}
          </button>
          <button className="employee-auth-cancel" type="button" onClick={handleCancel}>
            Back to Customer Mode
          </button>
        </form>
      </section>
    </main>
  );
}

export default EmployeeAuthentication;

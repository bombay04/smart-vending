import { useEffect, useState } from "react";
import {
  cancelKioskSession,
  fetchCurrentKioskSession,
  startRestockSession,
  type KioskSession,
} from "../api/kiosk-session";
import { getPortalSessionState } from "../portal-session-state.mjs";

interface StaffPortalProps {
  onBack: () => void;
}

function StaffPortal({ onBack }: StaffPortalProps) {
  const [session, setSession] = useState<KioskSession | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [sessionBusy, setSessionBusy] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

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

  async function handleStartRestock() {
    if (sessionBusy || session !== null) return;
    setSessionBusy(true);
    setSessionError(null);
    setMessage(null);
    try {
      setSession(await startRestockSession());
      setMessage("The kiosk is waiting for employee face authentication.");
    } catch (error) {
      setSessionError(
        error instanceof Error ? error.message : "Session request failed.",
      );
    } finally {
      setSessionBusy(false);
    }
  }

  async function handleCancelRestock() {
    if (session?.type !== "RESTOCK_AUTH" || sessionBusy) return;
    setSessionBusy(true);
    setSessionError(null);
    setMessage(null);
    try {
      await cancelKioskSession(session.id);
      setSession(null);
      setMessage("Restock session cancelled.");
    } catch (error) {
      setSessionError(
        error instanceof Error ? error.message : "Session request failed.",
      );
    } finally {
      setSessionBusy(false);
    }
  }

  const portalState = getPortalSessionState(session, "RESTOCK_AUTH");
  const secondsRemaining = session
    ? Math.max(
        0,
        Math.ceil((new Date(session.expiresAt).getTime() - now) / 1000),
      )
    : 0;

  return (
    <main className="home-page remote-portal-page staff-portal-page">
      <div className="staff-portal-container">
        <header className="staff-portal-header">
          <div>
            <p className="mode-label mode-label--employee">
              Prototype Staff Portal
            </p>
            <h1>Staff Operations</h1>
            <p>Start and monitor restocking on the customer kiosk.</p>
          </div>
          <button type="button" onClick={onBack}>
            Back to Home
          </button>
        </header>

        <section
          className="staff-session-section"
          aria-labelledby="restock-session-title"
        >
          <div className="staff-section-heading">
            <div>
              <h2 id="restock-session-title">Restock status</h2>
              <p>
                The kiosk verifies an active employee before opening Restock
                Mode.
              </p>
            </div>
            {portalState === "IDLE" && (
              <button
                className="staff-primary-action"
                type="button"
                disabled={
                  sessionBusy || !sessionLoaded || sessionError !== null
                }
                onClick={() => void handleStartRestock()}
              >
                {sessionBusy ? "Starting..." : "Start Restock"}
              </button>
            )}
          </div>

          {portalState === "OWN_SESSION" && session !== null && (
            <div className="staff-active-session" role="status">
              <div>
                <strong>Restock authentication ACTIVE</strong>
                <p>Kiosk waiting for employee face authentication.</p>
                <span>
                  Expires in {secondsRemaining}s ·{" "}
                  {new Date(session.expiresAt).toLocaleTimeString()}
                </span>
              </div>
              <button
                type="button"
                disabled={sessionBusy}
                onClick={() => void handleCancelRestock()}
              >
                Cancel
              </button>
            </div>
          )}

          {portalState === "KIOSK_BUSY" && (
            <div className="staff-busy-session" role="status">
              <strong>Kiosk busy</strong>
              <p>
                Another kiosk workflow is active. Restock can start when it
                finishes or expires.
              </p>
            </div>
          )}

          {sessionError && (
            <p className="staff-message staff-message--error">{sessionError}</p>
          )}
          {message && (
            <p className="staff-message staff-message--success">{message}</p>
          )}
        </section>
      </div>
    </main>
  );
}

export default StaffPortal;

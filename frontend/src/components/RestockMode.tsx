import { useEffect, useRef, useState } from "react";
import { fetchHardwareStatus } from "../api/hardware";
import { createMockRestock } from "../api/restock";
import type { MockRestockResult } from "../api/restock";
import type { AuthenticatedEmployee } from "../types/employee";
import type { HardwareSlotStatus } from "../types/hardware";

const POLLING_INTERVAL_MS = 2000;
const REQUEST_TIMEOUT_MS = 3000;
const STABLE_CLOSED_DURATION_MS = 2000;
const SUCCESS_DISPLAY_DURATION_MS = 3500;

type ValidationState = "READY" | "NOT_READY" | "CHECKING";

interface ValidatedSlotStatus extends HardwareSlotStatus {
  validationState: ValidationState;
}

interface RestockModeProps {
  authenticatedEmployee: AuthenticatedEmployee;
  onExit: () => void;
  onRestockSuccess: (restock: MockRestockResult) => void;
}

function validateSlots(
  slots: HardwareSlotStatus[],
  closedSinceBySlot: Map<number, number>,
  currentTime: number,
): ValidatedSlotStatus[] {
  return slots.map((slot) => {
    if (!slot.doorClosed) {
      closedSinceBySlot.delete(slot.slotNumber);

      return { ...slot, validationState: "NOT_READY" };
    }

    let closedSince = closedSinceBySlot.get(slot.slotNumber);
    if (closedSince === undefined) {
      closedSince = currentTime;
      closedSinceBySlot.set(slot.slotNumber, closedSince);
    }

    if (!slot.productPresent) {
      return { ...slot, validationState: "NOT_READY" };
    }

    const hasStableClosedDoor = currentTime - closedSince >= STABLE_CLOSED_DURATION_MS;

    return {
      ...slot,
      validationState: hasStableClosedDoor ? "READY" : "CHECKING",
    };
  });
}

function RestockMode({ authenticatedEmployee, onExit, onRestockSuccess }: RestockModeProps) {
  const [slots, setSlots] = useState<ValidatedSlotStatus[] | null>(null);
  const [isUnavailable, setIsUnavailable] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [restockError, setRestockError] = useState<string | null>(null);
  const [isSuccessful, setIsSuccessful] = useState(false);
  const submissionInProgressRef = useRef(false);
  const allSlotsReady =
    slots !== null &&
    slots.length === 3 &&
    slots.every((slot) => slot.validationState === "READY");

  useEffect(() => {
    let isActive = true;
    let pollingTimeoutId: number | undefined;
    let activeRequest: AbortController | null = null;
    const closedSinceBySlot = new Map<number, number>();

    async function pollHardwareStatus() {
      activeRequest = new AbortController();
      const requestTimeoutId = window.setTimeout(() => {
        activeRequest?.abort();
      }, REQUEST_TIMEOUT_MS);

      try {
        const response = await fetchHardwareStatus(activeRequest.signal);

        if (isActive) {
          setSlots(validateSlots(response.slots, closedSinceBySlot, Date.now()));
          setIsUnavailable(false);
        }
      } catch {
        if (isActive) {
          closedSinceBySlot.clear();
          setSlots(null);
          setIsUnavailable(true);
        }
      } finally {
        window.clearTimeout(requestTimeoutId);
        activeRequest = null;

        if (isActive) {
          pollingTimeoutId = window.setTimeout(pollHardwareStatus, POLLING_INTERVAL_MS);
        }
      }
    }

    void pollHardwareStatus();

    return () => {
      isActive = false;

      if (pollingTimeoutId !== undefined) {
        window.clearTimeout(pollingTimeoutId);
      }

      activeRequest?.abort();
    };
  }, []);

  useEffect(() => {
    if (!isSuccessful) {
      return undefined;
    }

    const timeoutId = window.setTimeout(onExit, SUCCESS_DISPLAY_DURATION_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isSuccessful, onExit]);

  async function handleConfirmRestock() {
    if (!allSlotsReady || submissionInProgressRef.current) {
      return;
    }

    submissionInProgressRef.current = true;
    setIsSubmitting(true);
    setRestockError(null);

    let restock: MockRestockResult;

    try {
      restock = await createMockRestock(authenticatedEmployee.id);
    } catch (error: unknown) {
      setRestockError(
        error instanceof Error ? error.message : "Failed to confirm restock. Please try again.",
      );
      submissionInProgressRef.current = false;
      setIsSubmitting(false);
      return;
    }

    onRestockSuccess(restock);
    setIsSuccessful(true);
  }

  if (isSuccessful) {
    return (
      <main className="home-page home-page--success restock-page">
        <section className="purchase-success restock-success" role="status" aria-live="polite">
          <div className="purchase-success__icon" aria-hidden="true">
            {"\u2713"}
          </div>
          <p className="mode-label mode-label--employee">Employee Mode</p>
          <h1>Restock Successful</h1>
          <p className="restock-success__inventory">Inventory has been restored.</p>
          <p className="purchase-success__return">Returning to Customer Mode...</p>
        </section>
      </main>
    );
  }

  return (
    <main className="home-page restock-page">
      <div className="customer-container">
        <header className="restock-header">
          <div>
            <p className="mode-label mode-label--employee">Employee Mode</p>
            <h1>Restock Mode</h1>
            <p className="instruction">
              Signed in as {authenticatedEmployee.name} ({authenticatedEmployee.employeeCode}) ·
              Current physical slot and door status
            </p>
          </div>
          <button
            className="restock-exit-button"
            type="button"
            disabled={isSubmitting}
            onClick={onExit}
          >
            Exit Restock Mode
          </button>
        </header>

        {slots === null && !isUnavailable && (
          <p className="state-message">Reading hardware status...</p>
        )}

        {isUnavailable && (
          <section className="hardware-unavailable" role="status">
            <h2>Hardware status unavailable</h2>
            <p>Check the Pi hardware service and ESP32 connection. Retrying automatically...</p>
          </section>
        )}

        {slots !== null && !isUnavailable && (
          <section className="hardware-grid" aria-label="Physical vending slot status">
            {slots.map((slot) => (
              <article className="hardware-card" key={slot.slotNumber}>
                <div className="hardware-card__header">
                  <h2>Slot {slot.slotNumber}</h2>
                  <strong
                    className={`validation-badge validation-badge--${slot.validationState
                      .toLowerCase()
                      .replace("_", "-")}`}
                  >
                    {slot.validationState.replace("_", " ")}
                  </strong>
                </div>

                <div className="hardware-status-row">
                  <span className="hardware-status-label">Product</span>
                  <strong
                    className={`hardware-value hardware-value--${
                      slot.productPresent ? "ready" : "attention"
                    }`}
                  >
                    {slot.productPresent ? "PRESENT" : "EMPTY"}
                  </strong>
                </div>

                <div className="hardware-status-row">
                  <span className="hardware-status-label">Door</span>
                  <strong
                    className={`hardware-value hardware-value--${
                      slot.doorClosed ? "ready" : "danger"
                    }`}
                  >
                    {slot.doorClosed ? "CLOSED" : "OPEN"}
                  </strong>
                </div>
              </article>
            ))}
          </section>
        )}

        <section
          className={`restock-confirmation${allSlotsReady ? " restock-confirmation--ready" : ""}`}
          aria-live="polite"
        >
          <div>
            <p>
              {allSlotsReady
                ? "All slots ready for restock confirmation"
                : "All slots must be READY before restock can be confirmed."}
            </p>
            {restockError && <p className="restock-error">{restockError}</p>}
          </div>
          <button
            className="confirm-restock-button"
            type="button"
            disabled={!allSlotsReady || isSubmitting}
            onClick={handleConfirmRestock}
          >
            {isSubmitting ? "Confirming..." : "Confirm Restock"}
          </button>
        </section>
      </div>
    </main>
  );
}

export default RestockMode;

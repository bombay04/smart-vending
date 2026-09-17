import { useEffect, useState } from "react";
import { fetchHardwareStatus } from "../api/hardware";
import type { HardwareSlotStatus } from "../types/hardware";

const POLLING_INTERVAL_MS = 2000;
const REQUEST_TIMEOUT_MS = 3000;

interface RestockModeProps {
  onExit: () => void;
}

function RestockMode({ onExit }: RestockModeProps) {
  const [slots, setSlots] = useState<HardwareSlotStatus[] | null>(null);
  const [isUnavailable, setIsUnavailable] = useState(false);

  useEffect(() => {
    let isActive = true;
    let pollingTimeoutId: number | undefined;
    let activeRequest: AbortController | null = null;

    async function pollHardwareStatus() {
      activeRequest = new AbortController();
      const requestTimeoutId = window.setTimeout(() => {
        activeRequest?.abort();
      }, REQUEST_TIMEOUT_MS);

      try {
        const response = await fetchHardwareStatus(activeRequest.signal);

        if (isActive) {
          setSlots(response.slots);
          setIsUnavailable(false);
        }
      } catch {
        if (isActive) {
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

  return (
    <main className="home-page restock-page">
      <div className="customer-container">
        <header className="restock-header">
          <div>
            <p className="mode-label mode-label--employee">Employee Mode</p>
            <h1>Restock Mode</h1>
            <p className="instruction">Current physical slot and door status</p>
          </div>
          <button className="restock-exit-button" type="button" onClick={onExit}>
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
                <h2>Slot {slot.slotNumber}</h2>

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
      </div>
    </main>
  );
}

export default RestockMode;

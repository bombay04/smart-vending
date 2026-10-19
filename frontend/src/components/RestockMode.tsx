import { useEffect, useRef, useState } from "react";
import { fetchHardwareStatus } from "../api/hardware";
import { createMockRestock } from "../api/restock";
import type { MockRestockResult } from "../api/restock";
import type { AuthenticatedEmployee } from "../types/employee";
import type { HardwareSlotStatus } from "../types/hardware";
import type { Slot } from "../types/slot";
import { unlockRestockSlot } from "../api/unlock";
import { playAudioFeedback } from "../api/audio";
import { commitRestockAndNotify } from "../audio-feedback.mjs";
import SuccessCheckIcon from "./SuccessCheckIcon";
import {
  applyRestockDoorObservations,
  beginRestockUnlock,
  clearRestockUnlockRequest,
  markRestockUnlockSent,
  type RestockUnlockCycle,
} from "../restock-unlock-cycle.mjs";

const POLLING_INTERVAL_MS = 2000;
const REQUEST_TIMEOUT_MS = 3000;
const STABLE_CLOSED_DURATION_MS = 2000;
const SUCCESS_DISPLAY_DURATION_MS = 3500;

type ValidationState = "READY" | "NOT_READY" | "CHECKING";

interface ValidatedSlotStatus extends HardwareSlotStatus {
  validationState: ValidationState;
}

interface RestockModeProps {
  sessionId: number;
  authenticatedEmployee: AuthenticatedEmployee;
  faceAuthorization: string;
  inventorySlots: Slot[];
  onExit: () => Promise<void>;
  onCompletedExit: () => void;
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

    const hasStableClosedDoor =
      currentTime - closedSince >= STABLE_CLOSED_DURATION_MS;

    return {
      ...slot,
      validationState: hasStableClosedDoor ? "READY" : "CHECKING",
    };
  });
}

function RestockMode({
  sessionId,
  authenticatedEmployee,
  faceAuthorization,
  inventorySlots,
  onExit,
  onCompletedExit,
  onRestockSuccess,
}: RestockModeProps) {
  const [slots, setSlots] = useState<ValidatedSlotStatus[] | null>(null);
  const [isUnavailable, setIsUnavailable] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [restockError, setRestockError] = useState<string | null>(null);
  const [isSuccessful, setIsSuccessful] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const [unlockCycles, setUnlockCycles] = useState<
    Map<number, RestockUnlockCycle>
  >(() => new Map());
  const [unlockFeedback, setUnlockFeedback] = useState<{
    slotNumber: number;
    tone: "success" | "error";
    message: string;
  } | null>(null);
  const submissionInProgressRef = useRef(false);
  const unlockCyclesRef = useRef(new Map<number, RestockUnlockCycle>());
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
          const observationTime = Date.now();
          setSlots(
            validateSlots(response.slots, closedSinceBySlot, observationTime),
          );
          setUnlockCycles((current) => {
            const next = applyRestockDoorObservations(
              current,
              response.slots,
              observationTime,
            );
            unlockCyclesRef.current = next;
            for (const [slotNumber, cycle] of next) {
              if (
                cycle.stage === "ASSISTANCE" &&
                current.get(slotNumber)?.stage !== "ASSISTANCE"
              ) {
                setUnlockFeedback({
                  slotNumber,
                  tone: "error",
                  message: "ไม่พบการเปิดช่อง กรุณาติดต่อผู้ดูแล ห้ามกดเปิดซ้ำ",
                });
              }
            }
            return next;
          });
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
          pollingTimeoutId = window.setTimeout(
            pollHardwareStatus,
            POLLING_INTERVAL_MS,
          );
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

    const timeoutId = window.setTimeout(
      onCompletedExit,
      SUCCESS_DISPLAY_DURATION_MS,
    );

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isSuccessful, onCompletedExit]);

  async function handleExitRestockMode() {
    if (isSubmitting || isExiting) return;
    setIsExiting(true);
    setRestockError(null);
    try {
      await onExit();
    } catch {
      setRestockError(
        "ไม่สามารถปิดโหมดเติมสินค้าได้ กรุณาตรวจสอบการเชื่อมต่อแล้วลองอีกครั้ง",
      );
      setIsExiting(false);
    }
  }

  async function handleConfirmRestock() {
    if (!allSlotsReady || submissionInProgressRef.current) {
      return;
    }

    submissionInProgressRef.current = true;
    setIsSubmitting(true);
    setRestockError(null);

    let restock: MockRestockResult;

    try {
      restock = await commitRestockAndNotify(authenticatedEmployee.id, {
        commitRestock: (employeeId) => createMockRestock(sessionId, employeeId),
        playAudio: playAudioFeedback,
      });
    } catch {
      setRestockError("ยืนยันการเติมสินค้าไม่สำเร็จ กรุณาลองอีกครั้ง");
      submissionInProgressRef.current = false;
      setIsSubmitting(false);
      return;
    }

    onRestockSuccess(restock);
    setIsSuccessful(true);
  }

  async function handleUnlockSlot(slotNumber: number) {
    const slot = slots?.find((item) => item.slotNumber === slotNumber);
    if (
      slot?.doorClosed !== true ||
      isSubmitting ||
      isExiting ||
      unlockCyclesRef.current.has(slotNumber)
    ) {
      return;
    }
    const requesting = beginRestockUnlock(
      unlockCyclesRef.current,
      slotNumber,
      Date.now(),
    );
    unlockCyclesRef.current = requesting;
    setUnlockCycles(requesting);
    setUnlockFeedback(null);
    try {
      await unlockRestockSlot(sessionId, slotNumber, faceAuthorization);
      const waitingForOpen = markRestockUnlockSent(
        unlockCyclesRef.current,
        slotNumber,
        Date.now(),
      );
      unlockCyclesRef.current = waitingForOpen;
      setUnlockCycles(waitingForOpen);
      setUnlockFeedback({
        slotNumber,
        tone: "success",
        message: `ส่งคำสั่งเปิดช่อง ${slotNumber} แล้ว กรุณาเปิดช่อง`,
      });
    } catch (error) {
      const cleared = clearRestockUnlockRequest(
        unlockCyclesRef.current,
        slotNumber,
      );
      unlockCyclesRef.current = cleared;
      setUnlockCycles(cleared);
      setUnlockFeedback({
        slotNumber,
        tone: "error",
        message:
          error instanceof Error && error.message
            ? error.message
            : `เปิดช่อง ${slotNumber} ไม่สำเร็จ กรุณาลองใหม่`,
      });
    }
  }

  if (isSuccessful) {
    return (
      <main className="home-page home-page--success restock-page">
        <section
          className="purchase-success restock-success"
          role="status"
          aria-live="polite"
        >
          <SuccessCheckIcon />
          <h1>เติมสินค้าสำเร็จ</h1>
          <p className="purchase-success__return">
            กำลังกลับสู่หน้าขายสินค้า...
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="home-page restock-page">
      <div className="customer-container">
        <header className="restock-header">
          <div>
            <h1>เติมสินค้า</h1>
            <p className="instruction restock-employee-identity">
              {authenticatedEmployee.employeeCode} - {authenticatedEmployee.name}
            </p>
          </div>
          <button
            className="restock-exit-button"
            type="button"
            disabled={isSubmitting || isExiting}
            onClick={() => void handleExitRestockMode()}
          >
            {isExiting
              ? "กำลังออกจากโหมดเติมสินค้า..."
              : "ออกจากโหมดเติมสินค้า"}
          </button>
        </header>

        {slots === null && !isUnavailable && (
          <p className="state-message">กำลังอ่านสถานะอุปกรณ์...</p>
        )}

        {isUnavailable && (
          <section className="hardware-unavailable" role="status">
            <h2>ไม่สามารถอ่านสถานะอุปกรณ์ได้</h2>
            <p>
              กรุณาตรวจสอบการเชื่อมต่ออุปกรณ์ ระบบจะลองอีกครั้งโดยอัตโนมัติ...
            </p>
          </section>
        )}

        {slots !== null && !isUnavailable && (
          <section
            className="hardware-grid"
            aria-label="สถานะช่องสินค้าและฝาตู้"
          >
            {slots.map((slot) => (
              <article className="hardware-card" key={slot.slotNumber}>
                {(() => {
                  const unlockCycle = unlockCycles.get(slot.slotNumber);
                  const doorIsClosed = slot.doorClosed === true;
                  const unlockButtonText =
                    slot.doorClosed === false
                      ? "ช่องเปิดอยู่แล้ว"
                      : !doorIsClosed
                        ? "ไม่ทราบสถานะฝาตู้"
                        : unlockCycle?.stage === "REQUESTING"
                          ? "กำลังเปิด..."
                          : unlockCycle?.stage === "WAITING_OPEN"
                            ? "รอเปิดช่อง"
                            : unlockCycle?.stage === "WAITING_CLOSED"
                              ? "รอปิดช่อง"
                              : unlockCycle?.stage === "ASSISTANCE"
                                ? "ต้องตรวจสอบ"
                                : `เปิดช่อง ${slot.slotNumber}`;
                  return (
                    <>
                      <div className="hardware-card__header">
                        <div>
                          <h2>ช่อง {slot.slotNumber}</h2>
                          <p className="restock-product-name">
                            {inventorySlots.find(
                              (item) => item.slotNumber === slot.slotNumber,
                            )?.product?.name ?? "ไม่มีสินค้า"}
                          </p>
                        </div>
                        <strong
                          className={`validation-badge validation-badge--${slot.validationState
                            .toLowerCase()
                            .replace("_", "-")}`}
                        >
                          {slot.validationState === "READY"
                            ? "พร้อม"
                            : slot.validationState === "CHECKING"
                              ? "กำลังตรวจสอบ"
                              : "ยังไม่พร้อม"}
                        </strong>
                      </div>

                      <div className="hardware-status-row">
                        <span className="hardware-status-label">สินค้า</span>
                        <strong
                          className={`hardware-value hardware-value--${
                            slot.productPresent ? "ready" : "attention"
                          }`}
                        >
                          {slot.productPresent ? "มีสินค้า" : "ไม่มีสินค้า"}
                        </strong>
                      </div>

                      <div className="hardware-status-row">
                        <span className="hardware-status-label">ฝาตู้</span>
                        <strong
                          className={`hardware-value hardware-value--${
                            slot.doorClosed ? "ready" : "danger"
                          }`}
                        >
                          {slot.doorClosed ? "ปิด" : "เปิด"}
                        </strong>
                      </div>
                      <button
                        className="restock-unlock-button"
                        type="button"
                        disabled={
                          !doorIsClosed ||
                          unlockCycle !== undefined ||
                          isSubmitting ||
                          isExiting
                        }
                        onClick={() => void handleUnlockSlot(slot.slotNumber)}
                      >
                        {unlockButtonText}
                      </button>
                      {unlockFeedback?.slotNumber === slot.slotNumber && (
                        <p
                          className={`restock-unlock-feedback restock-unlock-feedback--${unlockFeedback.tone}`}
                          role="status"
                        >
                          {unlockFeedback.message}
                        </p>
                      )}
                    </>
                  );
                })()}
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
                ? "ตรวจสอบว่าสินค้าครบทุกช่องและฝาตู้ปิดสนิทแล้ว"
                : "กรุณาตรวจสอบสินค้าในทุกช่องและปิดฝาตู้ให้สนิทก่อนยืนยันการเติมสินค้า"}
            </p>
            {restockError && <p className="restock-error">{restockError}</p>}
          </div>
          <button
            className="confirm-restock-button"
            type="button"
            disabled={!allSlotsReady || isSubmitting}
            onClick={handleConfirmRestock}
          >
            {isSubmitting ? "กำลังยืนยัน..." : "ยืนยันการเติมสินค้า"}
          </button>
        </section>
      </div>
    </main>
  );
}

export default RestockMode;

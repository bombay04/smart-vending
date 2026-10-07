import { useCallback, useEffect, useRef, useState } from "react";
import { fetchSlots } from "../api/slot";
import {
  cancelPayment,
  createPromptPayPayment,
  fetchPaymentStatus,
  PaymentApiError,
  type PaymentResult,
} from "../api/transaction";
import { unlockSlot } from "../api/unlock";
import { playAudioFeedback } from "../api/audio";
import EmployeeAuthentication from "../components/EmployeeAuthentication";
import RestockMode from "../components/RestockMode";
import EmployeeFaceRegistration from "../components/EmployeeFaceRegistration";
import { cancelFaceRegistrationSessionAndCleanup } from "../face-registration-session-cleanup.mjs";
import {
  cancelKioskSession,
  completeEmployeeOffboarding,
  fetchCurrentKioskSession,
  reportDraftDeleteResult,
  type KioskSession,
} from "../api/kiosk-session";
import {
  fetchFaceRegistrationStatuses,
  removeEmployeeFaceTemplate,
} from "../api/face-registration";
import {
  handleConfirmedPaymentOnce,
  resumeWaitingPaymentAfterCancellationReconciliation,
} from "../payment-flow.mjs";
import type { AuthenticatedEmployee } from "../types/employee";
import type { MockRestockResult } from "../api/restock";
import type { Slot } from "../types/slot";
import { decideKioskSessionAction } from "../kiosk-session-flow.mjs";
import { cancelRestockSessionAndCleanup } from "../restock-session-cleanup.mjs";
import { getProductDisplayName } from "../product-display";
import SuccessCheckIcon from "../components/SuccessCheckIcon";

interface PurchaseSuccess {
  slotNumber: number;
  productName: string;
}

export const PAYMENT_FAILURE_RETURN_MS = 2000;

type PaymentScreen =
  | { phase: "creating"; slotNumber: number; productName: string }
  | {
      phase: "waiting";
      payment: PaymentResult;
      pollError: string | null;
      cancelError: string | null;
      isCancelling: boolean;
    }
  | { phase: "unlocking"; payment: PaymentResult }
  | { phase: "failed"; payment: PaymentResult }
  | { phase: "unlock-failed"; payment: PaymentResult };

function HomePage() {
  const [activeMode, setActiveMode] = useState<
    "customer" | "employee-auth" | "restock" | "face-registration"
  >("customer");
  const [activeStaffSession, setActiveStaffSession] =
    useState<KioskSession | null>(null);
  const [authenticatedEmployee, setAuthenticatedEmployee] =
    useState<AuthenticatedEmployee | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const [paymentScreen, setPaymentScreen] = useState<PaymentScreen | null>(
    null,
  );
  const [purchaseSuccess, setPurchaseSuccess] =
    useState<PurchaseSuccess | null>(null);
  const unlockAttemptedTransactionIds = useRef(new Set<number>());
  const customerCancelledTransactionIds = useRef(new Set<number>());
  const cancellationInFlightTransactionIds = useRef(new Set<number>());
  const acceptedSessionIds = useRef(new Set<number>());
  const staffWorkflowCompletedRef = useRef(false);
  const maintenanceInFlightSessionId = useRef<number | null>(null);
  const waitingTransactionId =
    paymentScreen?.phase === "waiting" && !paymentScreen.isCancelling
      ? paymentScreen.payment.transactionId
      : null;

  const markSlotAsSoldOut = useCallback((slotNumber: number) => {
    setSlots((currentSlots) =>
      currentSlots.map((slot) =>
        slot.slotNumber === slotNumber ? { ...slot, status: "SOLD_OUT" } : slot,
      ),
    );
  }, []);

  const refreshSlotsAfterSale = useCallback(
    async (slotNumber: number) => {
      try {
        setSlots(await fetchSlots());
      } catch {
        markSlotAsSoldOut(slotNumber);
      }
    },
    [markSlotAsSoldOut],
  );

  const completeConfirmedPayment = useCallback(
    async (payment: PaymentResult) => {
      if (
        payment.customerCancelled ||
        customerCancelledTransactionIds.current.has(payment.transactionId)
      ) {
        return;
      }
      await handleConfirmedPaymentOnce(
        payment,
        unlockAttemptedTransactionIds.current,
        {
          onSaleConfirmed(confirmedPayment) {
            markSlotAsSoldOut(confirmedPayment.slotNumber);
            setPaymentScreen({ phase: "unlocking", payment: confirmedPayment });
          },
          unlock: unlockSlot,
          playAudio: playAudioFeedback,
          async onUnlocked(confirmedPayment) {
            await refreshSlotsAfterSale(confirmedPayment.slotNumber);
            setPaymentScreen(null);
            setPurchaseSuccess({
              slotNumber: confirmedPayment.slotNumber,
              productName: confirmedPayment.productName,
            });
          },
          async onUnlockFailed(confirmedPayment) {
            await refreshSlotsAfterSale(confirmedPayment.slotNumber);
            setPaymentScreen({
              phase: "unlock-failed",
              payment: confirmedPayment,
            });
          },
        },
      );
    },
    [markSlotAsSoldOut, refreshSlotsAfterSale],
  );

  const handleRestockSuccess = useCallback((restock: MockRestockResult) => {
    staffWorkflowCompletedRef.current = true;
    const restockedSlotNumbers = new Set(
      restock.slots.map((slot) => slot.slotNumber),
    );
    setSlots((currentSlots) =>
      currentSlots.map((slot) =>
        restockedSlotNumbers.has(slot.slotNumber)
          ? { ...slot, status: "AVAILABLE" }
          : slot,
      ),
    );
    setError(false);
    void fetchSlots()
      .then((data) => {
        setSlots(data);
        setError(false);
      })
      .catch(() => {
        // Keep the availability confirmed by the successful restock response.
      });
  }, []);

  const clearStaffWorkflowState = useCallback(() => {
    setAuthenticatedEmployee(null);
    setActiveStaffSession(null);
    staffWorkflowCompletedRef.current = false;
    setActiveMode("customer");
  }, []);

  const cancelActiveRestockSession = useCallback(async () => {
    if (activeStaffSession?.type !== "RESTOCK_AUTH") return;

    await cancelRestockSessionAndCleanup({
      sessionId: activeStaffSession.id,
      cancelSession: cancelKioskSession,
      clearLocalState: clearStaffWorkflowState,
    });
  }, [activeStaffSession, clearStaffWorkflowState]);

  const cancelActiveFaceRegistrationSession = useCallback(async () => {
    if (activeStaffSession?.type !== "FACE_REGISTRATION") return;

    await cancelFaceRegistrationSessionAndCleanup({
      sessionId: activeStaffSession.id,
      cancelSession: cancelKioskSession,
      clearLocalState: clearStaffWorkflowState,
    });
  }, [activeStaffSession, clearStaffWorkflowState]);

  const handleEmployeeAuthenticated = useCallback(
    (employee: AuthenticatedEmployee) => {
      setAuthenticatedEmployee(employee);
      setActiveMode("restock");
    },
    [],
  );

  async function handleBuy(slot: Slot) {
    if (!slot.product) {
      return;
    }

    setPurchaseError(null);
    setPaymentScreen({
      phase: "creating",
      slotNumber: slot.slotNumber,
      productName: slot.product.name,
    });

    try {
      const payment = await createPromptPayPayment(slot.slotNumber);
      if (
        payment.paymentStatus === "FAILED" ||
        payment.paymentStatus === "EXPIRED"
      ) {
        setPaymentScreen({ phase: "failed", payment });
      } else if (payment.paymentStatus === "SUCCESS") {
        await completeConfirmedPayment(payment);
      } else {
        setPaymentScreen({
          phase: "waiting",
          payment,
          pollError: null,
          cancelError: null,
          isCancelling: false,
        });
      }
    } catch {
      setPaymentScreen(null);
      setPurchaseError("ไม่สามารถเริ่มการชำระเงินได้ กรุณาลองอีกครั้ง");
    }
  }

  const handleCancelPayment = useCallback(
    async (payment: PaymentResult) => {
      const transactionId = payment.transactionId;
      if (cancellationInFlightTransactionIds.current.has(transactionId)) {
        return;
      }

      cancellationInFlightTransactionIds.current.add(transactionId);
      setPaymentScreen((current) =>
        current?.phase === "waiting" &&
        current.payment.transactionId === transactionId
          ? {
              ...current,
              isCancelling: true,
              pollError: null,
              cancelError: null,
            }
          : current,
      );

      try {
        const cancelledPayment = await cancelPayment(transactionId);
        if (cancelledPayment.customerCancelled) {
          customerCancelledTransactionIds.current.add(transactionId);
          setPaymentScreen((current) =>
            current?.phase === "waiting" &&
            current.payment.transactionId === transactionId
              ? null
              : current,
          );
          return;
        }
        throw new Error("Cancellation was not confirmed.");
      } catch (error: unknown) {
        if (
          error instanceof PaymentApiError &&
          error.code === "PAYMENT_ALREADY_CONFIRMED"
        ) {
          try {
            const currentPayment = await fetchPaymentStatus(transactionId);
            if (currentPayment.customerCancelled) {
              customerCancelledTransactionIds.current.add(transactionId);
              setPaymentScreen(null);
            } else if (currentPayment.paymentStatus === "SUCCESS") {
              await completeConfirmedPayment(currentPayment);
            } else if (
              currentPayment.paymentStatus === "FAILED" ||
              currentPayment.paymentStatus === "EXPIRED"
            ) {
              setPaymentScreen({ phase: "failed", payment: currentPayment });
            } else {
              setPaymentScreen((current) =>
                resumeWaitingPaymentAfterCancellationReconciliation(
                  current,
                  transactionId,
                  currentPayment,
                ),
              );
            }
            return;
          } catch {
            // Keep the QR visible so polling can continue reconciliation.
          }
        }

        setPaymentScreen((current) =>
          current?.phase === "waiting" &&
          current.payment.transactionId === transactionId
            ? {
                ...current,
                isCancelling: false,
                cancelError:
                  "ไม่สามารถยกเลิกรายการได้ กรุณาลองอีกครั้ง",
              }
            : current,
        );
      } finally {
        cancellationInFlightTransactionIds.current.delete(transactionId);
      }
    },
    [completeConfirmedPayment],
  );

  useEffect(() => {
    let isMounted = true;
    fetchSlots()
      .then((data) => {
        if (isMounted) setSlots(data);
      })
      .catch(() => {
        if (isMounted) setError(true);
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (waitingTransactionId === null) {
      return undefined;
    }

    let stopped = false;
    let timeoutId: number | undefined;
    let controller: AbortController | undefined;
    const transactionId = waitingTransactionId;

    const poll = async () => {
      controller = new AbortController();
      try {
        const payment = await fetchPaymentStatus(
          transactionId,
          controller.signal,
        );
        if (
          stopped ||
          customerCancelledTransactionIds.current.has(transactionId)
        ) {
          return;
        }

        if (payment.customerCancelled) {
          customerCancelledTransactionIds.current.add(transactionId);
          setPaymentScreen(null);
          return;
        }

        if (payment.paymentStatus === "SUCCESS") {
          await completeConfirmedPayment(payment);
          return;
        }
        if (
          payment.paymentStatus === "FAILED" ||
          payment.paymentStatus === "EXPIRED"
        ) {
          setPaymentScreen({ phase: "failed", payment });
          return;
        }

        setPaymentScreen((current) =>
          current?.phase === "waiting" &&
          current.payment.transactionId === transactionId
            ? { ...current, payment, pollError: null }
            : current,
        );
      } catch {
        if (!stopped) {
          setPaymentScreen((current) =>
            current?.phase === "waiting"
              ? {
                  ...current,
                  pollError:
                    "ไม่สามารถตรวจสอบการชำระเงินได้ ระบบจะลองอีกครั้ง",
                }
              : current,
          );
        }
      }

      if (!stopped) timeoutId = window.setTimeout(poll, 2000);
    };

    timeoutId = window.setTimeout(poll, 500);
    return () => {
      stopped = true;
      controller?.abort();
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [completeConfirmedPayment, waitingTransactionId]);

  useEffect(() => {
    if (paymentScreen?.phase !== "failed") return undefined;
    const timeoutId = window.setTimeout(
      () => setPaymentScreen(null),
      PAYMENT_FAILURE_RETURN_MS,
    );
    return () => window.clearTimeout(timeoutId);
  }, [paymentScreen]);

  useEffect(() => {
    let stopped = false;
    let timeoutId: number | undefined;
    let controller: AbortController | undefined;

    const poll = async () => {
      controller = new AbortController();
      try {
        const session = await fetchCurrentKioskSession(controller.signal);
        if (stopped) return;

        const action = decideKioskSessionAction({
          session,
          isSafeIdle: paymentScreen === null && purchaseSuccess === null,
          currentMode: activeMode,
          acceptedSessionIds: acceptedSessionIds.current,
          workflowCompleted: staffWorkflowCompletedRef.current,
        });
        if (action === "EXIT_STAFF") {
          setAuthenticatedEmployee(null);
          setActiveStaffSession(null);
          setActiveMode("customer");
        } else if (
          action === "START_RESTOCK_AUTH" ||
          action === "START_FACE_REGISTRATION"
        ) {
          if (session === null) return;
          acceptedSessionIds.current.add(session.id);
          staffWorkflowCompletedRef.current = false;
          setActiveStaffSession(session);
          setAuthenticatedEmployee(null);
          setActiveMode(
            action === "START_RESTOCK_AUTH"
              ? "employee-auth"
              : "face-registration",
          );
        } else if (
          action === "PROCESS_DRAFT_DELETE" ||
          action === "PROCESS_OFFBOARDING"
        ) {
          if (
            session?.employee === null ||
            session === null ||
            maintenanceInFlightSessionId.current !== null
          ) {
            return;
          }
          maintenanceInFlightSessionId.current = session.id;
          try {
            if (action === "PROCESS_DRAFT_DELETE") {
              const [templateStatus] = await fetchFaceRegistrationStatuses(
                [session.employee.employeeCode],
                controller.signal,
              );
              if (!templateStatus) return;
              await reportDraftDeleteResult(
                session.id,
                templateStatus.registered,
                controller.signal,
              );
            } else {
              await removeEmployeeFaceTemplate(
                session.employee.employeeCode,
                controller.signal,
              );
              await completeEmployeeOffboarding(session.id, controller.signal);
            }
            acceptedSessionIds.current.add(session.id);
          } finally {
            maintenanceInFlightSessionId.current = null;
          }
        }
      } catch {
        // Fail closed for staff entry while leaving customer purchasing unaffected.
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
  }, [activeMode, paymentScreen, purchaseSuccess]);

  useEffect(() => {
    if (purchaseSuccess === null) return undefined;
    const timeoutId = window.setTimeout(() => setPurchaseSuccess(null), 4000);
    return () => window.clearTimeout(timeoutId);
  }, [purchaseSuccess]);

  if (
    activeMode === "employee-auth" &&
    activeStaffSession?.type === "RESTOCK_AUTH"
  ) {
    return (
      <EmployeeAuthentication
        sessionId={activeStaffSession.id}
        onAuthenticated={handleEmployeeAuthenticated}
        onCancel={cancelActiveRestockSession}
      />
    );
  }

  if (
    activeMode === "restock" &&
    authenticatedEmployee !== null &&
    activeStaffSession?.type === "RESTOCK_AUTH"
  ) {
    return (
      <RestockMode
        sessionId={activeStaffSession.id}
        authenticatedEmployee={authenticatedEmployee}
        onExit={cancelActiveRestockSession}
        onCompletedExit={clearStaffWorkflowState}
        onRestockSuccess={handleRestockSuccess}
      />
    );
  }

  if (
    activeMode === "face-registration" &&
    activeStaffSession?.type === "FACE_REGISTRATION"
  ) {
    return (
      <EmployeeFaceRegistration
        session={activeStaffSession}
        onCancel={cancelActiveFaceRegistrationSession}
        onSessionEnded={clearStaffWorkflowState}
        onCompleted={() => {
          staffWorkflowCompletedRef.current = true;
          clearStaffWorkflowState();
        }}
      />
    );
  }

  if (purchaseSuccess !== null) {
    return (
      <main className="home-page home-page--success customer-kiosk-page">
        <section className="purchase-success" aria-live="polite">
          <SuccessCheckIcon />
          <h1>ขอบคุณค่ะ</h1>
          <p className="purchase-success__instruction">กรุณารับสินค้า</p>
        </section>
      </main>
    );
  }

  if (paymentScreen !== null) {
    const payment = "payment" in paymentScreen ? paymentScreen.payment : null;
    return (
      <main className="home-page payment-page customer-kiosk-page">
        <section
          className={`payment-card payment-card--${paymentScreen.phase}`}
          aria-live="polite"
        >
          {paymentScreen.phase === "creating" && (
            <>
              <h1>กำลังเตรียมการชำระเงิน</h1>
              <p>
                กำลังสร้าง QR สำหรับ
                {getProductDisplayName(paymentScreen.productName)}...
              </p>
              <div className="payment-spinner" aria-hidden="true" />
            </>
          )}

          {paymentScreen.phase === "waiting" && payment !== null && (
            <>
              <h1>สแกน QR เพื่อชำระเงิน</h1>
              <p className="payment-product">
                {getProductDisplayName(payment.productName)}
              </p>
              <p className="payment-amount">{payment.amount} บาท</p>
              {payment.qrImageUrl ? (
                <img
                  className="payment-qr"
                  src={payment.qrImageUrl}
                  alt="QR สำหรับชำระเงินพร้อมเพย์"
                />
              ) : (
                <p className="payment-message payment-message--error">
                  ไม่สามารถแสดง QR ได้
                </p>
              )}
              <p className="payment-waiting">
                กำลังรอยืนยันการชำระเงิน...
              </p>
              {payment.expiresAt && (
                <p className="payment-expiry">
                  กรุณาชำระเงินก่อน{" "}
                  {new Date(payment.expiresAt).toLocaleTimeString("th-TH")} น.
                </p>
              )}
              {paymentScreen.pollError && (
                <p className="payment-message payment-message--warning">
                  {paymentScreen.pollError}
                </p>
              )}
              {paymentScreen.cancelError && (
                <p className="payment-message payment-message--error">
                  {paymentScreen.cancelError}
                </p>
              )}
              <button
                className="payment-cancel-button"
                type="button"
                disabled={paymentScreen.isCancelling}
                onClick={() => void handleCancelPayment(payment)}
              >
                {paymentScreen.isCancelling ? "กำลังยกเลิก..." : "ยกเลิก"}
              </button>
            </>
          )}

          {paymentScreen.phase === "unlocking" && payment !== null && (
            <>
              <h1>ชำระเงินสำเร็จ</h1>
              <p>กำลังปลดล็อกช่อง {payment.slotNumber}...</p>
              <div className="payment-spinner" aria-hidden="true" />
            </>
          )}

          {paymentScreen.phase === "failed" && payment !== null && (
            <>
              <h1>
                {payment.paymentStatus === "EXPIRED"
                  ? "หมดเวลาชำระเงิน"
                  : "ชำระเงินไม่สำเร็จ"}
              </h1>
              <p>
                {payment.paymentStatus === "EXPIRED"
                  ? "กรุณาเลือกสินค้าและทำรายการใหม่"
                  : "กรุณาลองใหม่อีกครั้ง"}
              </p>
            </>
          )}

          {paymentScreen.phase === "unlock-failed" && payment !== null && (
            <>
              <div className="payment-warning-icon" aria-hidden="true">
                !
              </div>
              <h1>ชำระเงินสำเร็จ</h1>
              <p className="payment-message payment-message--error">
                ไม่สามารถปลดล็อกช่องสินค้าได้ กรุณาติดต่อพนักงาน
              </p>
              <p>
                การซื้อเสร็จสมบูรณ์แล้ว และช่อง {payment.slotNumber} ไม่มีสินค้า
              </p>
              <button
                className="payment-back-button"
                type="button"
                onClick={() => setPaymentScreen(null)}
              >
                กลับหน้าหลัก
              </button>
            </>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="home-page customer-kiosk-page">
      <div className="customer-container">
        <header className="page-header customer-page-header">
          <h1>Smart Vending Machine</h1>
        </header>

        {isLoading && <p className="state-message">กำลังโหลดช่องสินค้า...</p>}
        {error && (
          <p className="state-message state-message--error">
            ไม่สามารถโหลดช่องสินค้าได้
          </p>
        )}
        {purchaseError && (
          <p className="state-message state-message--error">{purchaseError}</p>
        )}

        {!isLoading && !error && (
          <section
            className="slot-grid"
            aria-label="สถานะช่องจำหน่ายสินค้า"
          >
            {slots.map((slot) => {
              const canBuy =
                slot.status === "AVAILABLE" && slot.product !== null;
              const buttonText =
                slot.product === null
                  ? "ไม่พร้อมจำหน่าย"
                  : slot.status === "SOLD_OUT"
                    ? "สินค้าหมด"
                    : "ซื้อ";
              return (
                <article
                  className={`slot-card${slot.status === "SOLD_OUT" ? " slot-card--sold-out" : ""}`}
                  key={slot.id}
                >
                  <div className="slot-card__header">
                    <span className="slot-number">ช่อง {slot.slotNumber}</span>
                    <span
                      className={`status-badge status-badge--${slot.status.toLowerCase()}`}
                    >
                      {slot.status === "AVAILABLE"
                        ? "พร้อมจำหน่าย"
                        : "สินค้าหมด"}
                    </span>
                  </div>
                  {slot.product ? (
                    <>
                      <div className="product-media">
                        {slot.product.imageUrl ? (
                          <img
                            src={slot.product.imageUrl}
                            alt={getProductDisplayName(slot.product.name)}
                          />
                        ) : (
                          <span aria-hidden="true">
                            {slot.product.name.charAt(0)}
                          </span>
                        )}
                      </div>
                      <h2 className="product-name">
                        {getProductDisplayName(slot.product.name)}
                      </h2>
                      <p className="product-price">
                        {slot.product.price} <span>บาท</span>
                      </p>
                    </>
                  ) : (
                    <div className="empty-product">
                      <span aria-hidden="true">—</span>
                      <h2 className="product-name">ไม่มีสินค้า</h2>
                    </div>
                  )}
                  <button
                    className="buy-button"
                    type="button"
                    disabled={!canBuy}
                    onClick={() => void handleBuy(slot)}
                  >
                    {buttonText}
                  </button>
                </article>
              );
            })}
          </section>
        )}
      </div>
    </main>
  );
}

export default HomePage;

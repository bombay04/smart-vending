import { useCallback, useEffect, useRef, useState } from "react";
import { fetchSlots } from "../api/slot";
import {
  createPromptPayPayment,
  fetchPaymentStatus,
  type PaymentResult,
} from "../api/transaction";
import { unlockSlot } from "../api/unlock";
import { playAudioFeedback } from "../api/audio";
import EmployeeAuthentication from "../components/EmployeeAuthentication";
import RestockMode from "../components/RestockMode";
import { handleConfirmedPaymentOnce } from "../payment-flow.mjs";
import type { AuthenticatedEmployee } from "../types/employee";
import type { MockRestockResult } from "../api/restock";
import type { Slot } from "../types/slot";

interface PurchaseSuccess {
  slotNumber: number;
  productName: string;
}

type PaymentScreen =
  | { phase: "creating"; slotNumber: number; productName: string }
  | { phase: "waiting"; payment: PaymentResult; pollError: string | null }
  | { phase: "unlocking"; payment: PaymentResult }
  | { phase: "failed"; payment: PaymentResult }
  | { phase: "unlock-failed"; payment: PaymentResult };

function HomePage() {
  const [activeMode, setActiveMode] = useState<
    "customer" | "employee-auth" | "restock"
  >("customer");
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
  const waitingTransactionId =
    paymentScreen?.phase === "waiting"
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

  const exitRestockMode = useCallback(() => {
    setAuthenticatedEmployee(null);
    setActiveMode("customer");
  }, []);

  const cancelEmployeeAuthentication = useCallback(() => {
    setAuthenticatedEmployee(null);
    setActiveMode("customer");
  }, []);

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
        setPaymentScreen({ phase: "waiting", payment, pollError: null });
      }
    } catch (paymentFailure: unknown) {
      setPaymentScreen(null);
      setPurchaseError(
        paymentFailure instanceof Error
          ? paymentFailure.message
          : "Unable to start payment. Please try again.",
      );
    }
  }

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
        if (stopped) return;

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

        setPaymentScreen({ phase: "waiting", payment, pollError: null });
      } catch (pollFailure: unknown) {
        if (!stopped) {
          setPaymentScreen((current) =>
            current?.phase === "waiting"
              ? {
                  ...current,
                  pollError:
                    pollFailure instanceof Error
                      ? pollFailure.message
                      : "Unable to check payment. We will keep trying.",
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
    if (purchaseSuccess === null) return undefined;
    const timeoutId = window.setTimeout(() => setPurchaseSuccess(null), 4000);
    return () => window.clearTimeout(timeoutId);
  }, [purchaseSuccess]);

  if (activeMode === "employee-auth") {
    return (
      <EmployeeAuthentication
        onAuthenticated={handleEmployeeAuthenticated}
        onCancel={cancelEmployeeAuthentication}
      />
    );
  }

  if (activeMode === "restock" && authenticatedEmployee !== null) {
    return (
      <RestockMode
        authenticatedEmployee={authenticatedEmployee}
        onExit={exitRestockMode}
        onRestockSuccess={handleRestockSuccess}
      />
    );
  }

  if (purchaseSuccess !== null) {
    return (
      <main className="home-page home-page--success">
        <section className="purchase-success" aria-live="polite">
          <div className="purchase-success__icon" aria-hidden="true">
            ✓
          </div>
          <p className="mode-label">Customer Mode</p>
          <h1>Thank You</h1>
          <p className="purchase-success__product">
            Payment successful — {purchaseSuccess.productName}
          </p>
          <p className="purchase-success__slot">
            Slot <strong>{purchaseSuccess.slotNumber}</strong> is unlocked.
          </p>
          <p className="purchase-success__instruction">
            Please take your product.
          </p>
          <p className="purchase-success__return">
            Returning to product selection...
          </p>
        </section>
      </main>
    );
  }

  if (paymentScreen !== null) {
    const payment = "payment" in paymentScreen ? paymentScreen.payment : null;
    return (
      <main className="home-page payment-page">
        <section className="payment-card" aria-live="polite">
          <p className="mode-label">PromptPay</p>
          {paymentScreen.phase === "creating" && (
            <>
              <h1>Preparing payment</h1>
              <p>
                Creating a secure QR code for {paymentScreen.productName}...
              </p>
              <div className="payment-spinner" aria-hidden="true" />
            </>
          )}

          {paymentScreen.phase === "waiting" && payment !== null && (
            <>
              <h1>Scan to pay</h1>
              <p className="payment-product">{payment.productName}</p>
              <p className="payment-amount">{payment.amount} THB</p>
              {payment.qrImageUrl ? (
                <img
                  className="payment-qr"
                  src={payment.qrImageUrl}
                  alt="PromptPay payment QR code"
                />
              ) : (
                <p className="payment-message payment-message--error">
                  QR code unavailable.
                </p>
              )}
              <p className="payment-waiting">
                Waiting for payment confirmation...
              </p>
              {payment.expiresAt && (
                <p className="payment-expiry">
                  Please complete payment before{" "}
                  {new Date(payment.expiresAt).toLocaleTimeString()}.
                </p>
              )}
              {paymentScreen.pollError && (
                <p className="payment-message payment-message--warning">
                  {paymentScreen.pollError}
                </p>
              )}
            </>
          )}

          {paymentScreen.phase === "unlocking" && payment !== null && (
            <>
              <h1>Payment successful</h1>
              <p>Unlocking slot {payment.slotNumber}...</p>
              <div className="payment-spinner" aria-hidden="true" />
            </>
          )}

          {paymentScreen.phase === "failed" && payment !== null && (
            <>
              <h1>
                {payment.paymentStatus === "EXPIRED"
                  ? "Payment expired"
                  : "Payment unsuccessful"}
              </h1>
              <p>
                Your payment was not completed. The compartment was not
                unlocked.
              </p>
              <button
                className="payment-back-button"
                type="button"
                onClick={() => setPaymentScreen(null)}
              >
                Back to products
              </button>
            </>
          )}

          {paymentScreen.phase === "unlock-failed" && payment !== null && (
            <>
              <div className="payment-warning-icon" aria-hidden="true">
                !
              </div>
              <h1>Payment successful</h1>
              <p className="payment-message payment-message--error">
                Unable to unlock the compartment. Please contact staff.
              </p>
              <p>
                Your purchase remains complete and slot {payment.slotNumber} is
                sold out.
              </p>
              <button
                className="payment-back-button"
                type="button"
                onClick={() => setPaymentScreen(null)}
              >
                Return home
              </button>
            </>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="home-page">
      <div className="customer-container">
        <header className="page-header">
          <p className="mode-label">Customer Mode</p>
          <h1>Smart Vending Machine</h1>
          <p className="instruction">Please select a product</p>
          <button
            className="employee-mode-button"
            type="button"
            onClick={() => {
              setAuthenticatedEmployee(null);
              setActiveMode("employee-auth");
            }}
          >
            Employee Mode
          </button>
        </header>

        {isLoading && <p className="state-message">Loading slots...</p>}
        {error && (
          <p className="state-message state-message--error">
            Failed to load slots.
          </p>
        )}
        {purchaseError && (
          <p className="state-message state-message--error">{purchaseError}</p>
        )}

        {!isLoading && !error && (
          <section
            className="slot-grid"
            aria-label="Available vending machine slots"
          >
            {slots.map((slot) => {
              const canBuy =
                slot.status === "AVAILABLE" && slot.product !== null;
              const buttonText =
                slot.product === null
                  ? "Unavailable"
                  : slot.status === "SOLD_OUT"
                    ? "Sold Out"
                    : "Buy";
              return (
                <article
                  className={`slot-card${slot.status === "SOLD_OUT" ? " slot-card--sold-out" : ""}`}
                  key={slot.id}
                >
                  <div className="slot-card__header">
                    <span className="slot-number">Slot {slot.slotNumber}</span>
                    <span
                      className={`status-badge status-badge--${slot.status.toLowerCase()}`}
                    >
                      {slot.status}
                    </span>
                  </div>
                  {slot.product ? (
                    <>
                      <div className="product-media">
                        {slot.product.imageUrl ? (
                          <img
                            src={slot.product.imageUrl}
                            alt={slot.product.name}
                          />
                        ) : (
                          <span aria-hidden="true">
                            {slot.product.name.charAt(0)}
                          </span>
                        )}
                      </div>
                      <h2 className="product-name">{slot.product.name}</h2>
                      <p className="product-price">
                        {slot.product.price} <span>THB</span>
                      </p>
                    </>
                  ) : (
                    <div className="empty-product">
                      <span aria-hidden="true">—</span>
                      <h2 className="product-name">No product</h2>
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

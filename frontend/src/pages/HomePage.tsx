import { useEffect, useState } from "react";
import { fetchSlots } from "../api/slot";
import { createMockPurchase } from "../api/transaction";
import { unlockSlot } from "../api/unlock";
import type { Slot } from "../types/slot";

interface PurchaseSuccess {
  slotNumber: number;
  productName: string;
}

function HomePage() {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const [purchasingSlotNumber, setPurchasingSlotNumber] = useState<number | null>(null);
  const [purchaseSuccess, setPurchaseSuccess] = useState<PurchaseSuccess | null>(null);

  function markSlotAsSoldOut(slotNumber: number) {
    setSlots((currentSlots) =>
      currentSlots.map((slot) =>
        slot.slotNumber === slotNumber ? { ...slot, status: "SOLD_OUT" } : slot,
      ),
    );
  }

  async function handleBuy(slotNumber: number) {
    setPurchaseError(null);
    setIsPurchasing(true);
    setPurchasingSlotNumber(slotNumber);

    try {
      const purchase = await createMockPurchase(slotNumber);

      try {
        await unlockSlot(slotNumber);
      } catch {
        setPurchaseError("Purchase successful, but unlock failed. Please contact staff.");
        markSlotAsSoldOut(slotNumber);

        try {
          setSlots(await fetchSlots());
        } catch {
          // Keep the local sold-out state when refreshing fails.
        }

        return;
      }

      try {
        setSlots(await fetchSlots());
      } catch {
        markSlotAsSoldOut(slotNumber);
      }

      setPurchaseSuccess({
        slotNumber,
        productName: purchase.productName,
      });
    } catch (purchaseFailure: unknown) {
      setPurchaseError(
        purchaseFailure instanceof Error ? purchaseFailure.message : "Failed to complete purchase.",
      );
    } finally {
      setIsPurchasing(false);
      setPurchasingSlotNumber(null);
    }
  }

  useEffect(() => {
    let isMounted = true;

    fetchSlots()
      .then((data) => {
        if (isMounted) {
          setSlots(data);
        }
      })
      .catch(() => {
        if (isMounted) {
          setError(true);
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (purchaseSuccess === null) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setPurchaseSuccess(null);
    }, 4000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [purchaseSuccess]);

  if (purchaseSuccess !== null) {
    return (
      <main className="home-page home-page--success">
        <section className="purchase-success" aria-live="polite">
          <div className="purchase-success__icon" aria-hidden="true">
            ✓
          </div>
          <p className="mode-label">Customer Mode</p>
          <h1>Purchase Successful</h1>
          <p className="purchase-success__product">{purchaseSuccess.productName}</p>
          <p className="purchase-success__slot">
            Slot <strong>{purchaseSuccess.slotNumber}</strong> is unlocked.
          </p>
          <p className="purchase-success__instruction">Please take your product.</p>
          <p className="purchase-success__return">Returning to product selection...</p>
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
        </header>

        {isLoading && <p className="state-message">Loading slots...</p>}
        {error && <p className="state-message state-message--error">Failed to load slots.</p>}
        {purchaseError && (
          <p className="state-message state-message--error">{purchaseError}</p>
        )}

        {!isLoading && !error && (
          <section className="slot-grid" aria-label="Available vending machine slots">
            {slots.map((slot) => {
              const canBuy = slot.status === "AVAILABLE" && slot.product !== null;
              const buttonText =
                slot.product === null ? "Unavailable" : slot.status === "SOLD_OUT" ? "Sold Out" : "Buy";

              return (
                <article
                  className={`slot-card${slot.status === "SOLD_OUT" ? " slot-card--sold-out" : ""}`}
                  key={slot.id}
                >
                  <div className="slot-card__header">
                    <span className="slot-number">Slot {slot.slotNumber}</span>
                    <span className={`status-badge status-badge--${slot.status.toLowerCase()}`}>
                      {slot.status}
                    </span>
                  </div>

                  {slot.product ? (
                    <>
                      <div className="product-media">
                        {slot.product.imageUrl ? (
                          <img src={slot.product.imageUrl} alt={slot.product.name} />
                        ) : (
                          <span aria-hidden="true">{slot.product.name.charAt(0)}</span>
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
                    disabled={!canBuy || isPurchasing}
                    onClick={() => handleBuy(slot.slotNumber)}
                  >
                    {isPurchasing && purchasingSlotNumber === slot.slotNumber
                      ? "Processing..."
                      : buttonText}
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

import { useEffect, useState } from "react";
import { fetchSlots } from "../api/slot";
import type { Slot } from "../types/slot";

function HomePage() {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);

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

                  <button className="buy-button" type="button" disabled={!canBuy}>
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

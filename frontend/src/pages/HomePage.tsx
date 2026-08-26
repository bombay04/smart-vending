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
      <section className="intro">
        <h1>Smart Vending Machine</h1>
        <p className="subtitle">Customer Mode</p>

        {isLoading && <p className="placeholder">Loading slots...</p>}
        {error && <p>Failed to load slots.</p>}

        {!isLoading && !error && (
          <div>
            {slots.map((slot) => {
              const canBuy = slot.status === "AVAILABLE" && slot.product !== null;
              const buttonText =
                slot.product === null ? "Unavailable" : slot.status === "SOLD_OUT" ? "Sold Out" : "Buy";

              return (
                <article key={slot.id}>
                  <h2>Slot {slot.slotNumber}</h2>
                  {slot.product ? (
                    <>
                      {slot.product.imageUrl && (
                        <img src={slot.product.imageUrl} alt={slot.product.name} />
                      )}
                      <p>{slot.product.name}</p>
                      <p>Price: {slot.product.price}</p>
                    </>
                  ) : (
                    <p>No product</p>
                  )}
                  <p>Status: {slot.status}</p>
                  <button type="button" disabled={!canBuy}>
                    {buttonText}
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}

export default HomePage;

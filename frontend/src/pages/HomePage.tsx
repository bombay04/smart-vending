import { useEffect, useState } from "react";
import { fetchProducts } from "../api/product";
import type { Product } from "../types/product";

function HomePage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let isMounted = true;

    fetchProducts()
      .then((data) => {
        if (isMounted) {
          setProducts(data);
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

        {isLoading && <p className="placeholder">Loading products...</p>}
        {error && <p>Failed to load products.</p>}

        {!isLoading && !error && (
          <div>
            {products.map((product) => (
              <article key={product.id}>
                {product.imageUrl && <img src={product.imageUrl} alt={product.name} />}
                <h2>{product.name}</h2>
                <p>Price: {product.price}</p>
                <p>Status: {product.isActive ? "Active" : "Inactive"}</p>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

export default HomePage;

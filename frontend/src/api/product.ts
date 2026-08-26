import type { Product, ProductResponse } from "../types/product";

const productsUrl = "http://localhost:3000/api/v1/products";

export async function fetchProducts(): Promise<Product[]> {
  const response = await fetch(productsUrl);

  if (!response.ok) {
    throw new Error("Failed to fetch products.");
  }

  const responseData = (await response.json()) as ProductResponse;

  return responseData.data;
}

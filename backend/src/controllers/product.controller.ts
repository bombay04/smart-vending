import type { Request, Response } from "express";
import { getActiveProducts } from "../services/product.service";

export async function listProducts(request: Request, response: Response): Promise<void> {
  void request;

  const products = await getActiveProducts();

  response.status(200).json({ data: products });
}

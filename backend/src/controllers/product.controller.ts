import type { NextFunction, Request, Response } from "express";
import { getActiveProducts } from "../services/product.service";

export async function listProducts(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  void request;

  try {
    const products = await getActiveProducts();

    response.status(200).json({ data: products });
  } catch (error: unknown) {
    next(error);
  }
}

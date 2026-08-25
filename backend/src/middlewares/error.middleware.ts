import type { NextFunction, Request, Response } from "express";
import { HttpError } from "../utils/http-error";

export function errorMiddleware(
  error: unknown,
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  void request;
  void next;

  if (error instanceof HttpError) {
    response.status(error.statusCode).json({ error: error.message });
    return;
  }

  response.status(500).json({ error: "Internal server error" });
}

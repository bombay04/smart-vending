import type { NextFunction, Request, Response } from "express";
import {
  cancelKioskSession,
  completeKioskSession,
  createFaceRegistrationSession,
  createRestockSession,
  getCurrentKioskSession,
} from "../services/kiosk-session.service";
import { HttpError } from "../utils/http-error";

function requireEmptyBody(body: unknown): void {
  if (
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body) ||
    Object.keys(body).length
  ) {
    throw new HttpError("Request body must be an empty object.", 400);
  }
}

export async function currentKioskSession(
  _request: Request,
  response: Response,
  next: NextFunction,
) {
  try {
    const session = await getCurrentKioskSession();
    response.status(200).json({ mode: session?.type ?? "CUSTOMER", session });
  } catch (error) {
    next(error);
  }
}

export async function startRestockSession(
  request: Request,
  response: Response,
  next: NextFunction,
) {
  try {
    requireEmptyBody(request.body);
    response.status(201).json({ session: await createRestockSession() });
  } catch (error) {
    next(error);
  }
}

export async function startFaceRegistrationSession(
  request: Request,
  response: Response,
  next: NextFunction,
) {
  try {
    if (
      typeof request.body !== "object" ||
      request.body === null ||
      Array.isArray(request.body) ||
      Object.keys(request.body).length !== 1 ||
      !("employeeId" in request.body)
    )
      throw new HttpError("Request body must contain only employeeId.", 400);
    response
      .status(201)
      .json({ session: await createFaceRegistrationSession(request.body.employeeId) });
  } catch (error) {
    next(error);
  }
}

export async function completeSession(request: Request, response: Response, next: NextFunction) {
  try {
    requireEmptyBody(request.body);
    response
      .status(200)
      .json({ session: await completeKioskSession(Number(request.params.sessionId)) });
  } catch (error) {
    next(error);
  }
}

export async function cancelSession(request: Request, response: Response, next: NextFunction) {
  try {
    requireEmptyBody(request.body);
    response
      .status(200)
      .json({ session: await cancelKioskSession(Number(request.params.sessionId)) });
  } catch (error) {
    next(error);
  }
}

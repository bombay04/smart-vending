import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";

export async function getHealth(request: Request, response: Response): Promise<void> {
  void request;

  try {
    await prisma.$queryRaw`SELECT 1`;

    response.status(200).json({
      status: "ok",
      database: "connected",
      timestamp: new Date().toISOString(),
    });
  } catch {
    response.status(503).json({
      status: "error",
      database: "disconnected",
      timestamp: new Date().toISOString(),
    });
  }
}

import type { Request, Response } from "express";
import {
  ingestHardwareHeartbeat,
  StaleHeartbeatError,
} from "../hardware/hardware-monitoring.service";
import { InvalidHeartbeatError, parseHeartbeat } from "../hardware/hardware-monitoring";

export async function receiveHardwareHeartbeat(
  request: Request,
  response: Response,
): Promise<void> {
  try {
    const heartbeat = parseHeartbeat(request.body);
    if (heartbeat.machineId !== response.locals.machineId) {
      response
        .status(403)
        .json({ error: "Heartbeat machine identity does not match its credential." });
      return;
    }
    const result = await ingestHardwareHeartbeat(heartbeat);
    response.status(202).json({ status: "accepted", connectivity: result.connectivity });
  } catch (error) {
    if (error instanceof InvalidHeartbeatError) {
      response.status(400).json({ error: error.message });
      return;
    }
    if (error instanceof StaleHeartbeatError) {
      response.status(409).json({ error: error.message });
      return;
    }
    throw error;
  }
}

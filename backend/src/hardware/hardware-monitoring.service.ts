import { randomUUID } from "node:crypto";
import { Prisma } from "../../generated/prisma-client";
import { prisma } from "../lib/prisma";
import {
  HARDWARE_ALERT_MAX_ATTEMPTS,
  hardwareAlertFailureDisposition,
  isHeartbeatStale,
  LINE_RETRY_KEY_VALIDITY_MS,
  type HardwareHeartbeatInput,
} from "./hardware-monitoring";
import { createHardwareAlertFlex, HARDWARE_CONNECTIVITY_COPY } from "./hardware-alert-flex";
import { getMaintenanceAlertProvider } from "./maintenance-line-alert.provider";
import {
  OwnerReportDeliveryError,
  serializeOwnerReportPayload,
  type OwnerReportDeliveryMetadata,
  type OwnerReportProvider,
} from "../reports/owner-line-report.provider";

export const OFFLINE_THRESHOLD_MS = 2 * 60_000;
export const OFFLINE_CONFIRMATION_MS = 2 * 60_000;
export const EVALUATOR_CONTINUITY_MAX_GAP_MS = 90_000;
export const HARDWARE_ALERT_CLAIM_STALE_MS = 5 * 60_000;
const SERIALIZABLE_RETRIES = 3;

export class StaleHeartbeatError extends Error {}
class ConcurrentHardwareStateError extends Error {}

type Connectivity = "ONLINE" | "OFFLINE";
type AlertTransition = "OFFLINE" | "RECOVERED";

function isPrismaConflict(error: unknown): boolean {
  if (error instanceof ConcurrentHardwareStateError) return true;
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "P2034" || error.code === "P2002")
  );
}

async function serializable<T>(
  work: (database: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; attempt <= SERIALIZABLE_RETRIES; attempt += 1) {
    try {
      return await prisma.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error: unknown) {
      if (!isPrismaConflict(error) || attempt === SERIALIZABLE_RETRIES) throw error;
    }
  }
  throw new Error("Serializable transaction retry limit exceeded.");
}

function payloadForConnectivityEvent(input: {
  machineId: string;
  transition: AlertTransition;
  detectedAt: Date;
}): { description: string; recommendedAction: string; payloadSnapshot: string } {
  const recovered = input.transition === "RECOVERED";
  const { description, recommendedAction } = HARDWARE_CONNECTIVITY_COPY[input.transition];
  const message = createHardwareAlertFlex({
    machineId: input.machineId,
    severity: recovered ? "RECOVERED" : "CRITICAL",
    affectedHardware: "Pi Cloud Relay",
    description,
    detectedAt: input.detectedAt,
    recommendedAction,
  });
  return {
    description,
    recommendedAction,
    payloadSnapshot: serializeOwnerReportPayload(message),
  };
}

async function createConnectivityAlert(
  database: Prisma.TransactionClient,
  input: { machineId: string; transition: AlertTransition; detectedAt: Date },
): Promise<void> {
  const content = payloadForConnectivityEvent(input);
  await database.hardwareAlertEvent.create({
    data: {
      machineId: input.machineId,
      transition: input.transition,
      severity: input.transition === "RECOVERED" ? "RECOVERED" : "CRITICAL",
      detectedAt: input.detectedAt,
      description: content.description,
      recommendedAction: content.recommendedAction,
      payloadSnapshot: content.payloadSnapshot,
      retryKey: randomUUID(),
      retryKeyCreatedAt: input.detectedAt,
    },
  });
}

export async function ingestHardwareHeartbeat(
  heartbeat: HardwareHeartbeatInput,
  receivedAt = new Date(),
): Promise<{ accepted: true; connectivity: Connectivity }> {
  return serializable(async (database) => {
    const machine = await database.hardwareMachine.findUnique({
      where: { machineId: heartbeat.machineId },
    });

    if (!machine) {
      await database.hardwareMachine.create({
        data: {
          machineId: heartbeat.machineId,
          connectivity: "ONLINE",
          enrolledAt: receivedAt,
          lastHeartbeatAt: receivedAt,
          lastObservedAt: heartbeat.observedAt,
          lastSequence: heartbeat.sequence,
          lastEvaluatedAt: receivedAt,
        },
      });
      return { accepted: true, connectivity: "ONLINE" } as const;
    }

    if (isHeartbeatStale(machine.lastSequence, machine.lastObservedAt, heartbeat)) {
      throw new StaleHeartbeatError("Heartbeat is duplicate or out of order.");
    }

    const recovered = machine.connectivity === "OFFLINE";
    const updated = await database.hardwareMachine.updateMany({
      where: {
        machineId: heartbeat.machineId,
        connectivity: machine.connectivity,
        lastSequence: machine.lastSequence,
        lastObservedAt: machine.lastObservedAt,
      },
      data: {
        connectivity: "ONLINE",
        lastHeartbeatAt: receivedAt,
        lastObservedAt: heartbeat.observedAt,
        lastSequence: heartbeat.sequence,
        offlineCandidateSince: null,
        offlineSince: null,
        lastEvaluatedAt: receivedAt,
      },
    });
    if (updated.count !== 1) {
      throw new ConcurrentHardwareStateError("Concurrent heartbeat update.");
    }
    if (recovered) {
      await createConnectivityAlert(database, {
        machineId: heartbeat.machineId,
        transition: "RECOVERED",
        detectedAt: receivedAt,
      });
    }
    return { accepted: true, connectivity: "ONLINE" } as const;
  });
}

export type OfflineEvaluationDecision = "FRESH" | "START_CONFIRMATION" | "WAIT" | "OFFLINE";

export function offlineEvaluationDecision(
  machine: {
    lastHeartbeatAt: Date;
    offlineCandidateSince: Date | null;
    lastEvaluatedAt: Date | null;
  },
  now: Date,
): OfflineEvaluationDecision {
  if (machine.lastHeartbeatAt.getTime() > now.getTime() - OFFLINE_THRESHOLD_MS) return "FRESH";
  const evaluatorContinuityLost =
    machine.lastEvaluatedAt === null ||
    machine.lastEvaluatedAt.getTime() < now.getTime() - EVALUATOR_CONTINUITY_MAX_GAP_MS;
  if (machine.offlineCandidateSince === null || evaluatorContinuityLost) {
    return "START_CONFIRMATION";
  }
  return machine.offlineCandidateSince.getTime() <= now.getTime() - OFFLINE_CONFIRMATION_MS
    ? "OFFLINE"
    : "WAIT";
}

async function evaluateMachineOffline(machineId: string, now: Date): Promise<boolean> {
  return serializable(async (database) => {
    const machine = await database.hardwareMachine.findUnique({ where: { machineId } });
    if (!machine || machine.connectivity !== "ONLINE" || !machine.lastHeartbeatAt) return false;
    const decision = offlineEvaluationDecision(
      {
        lastHeartbeatAt: machine.lastHeartbeatAt,
        offlineCandidateSince: machine.offlineCandidateSince,
        lastEvaluatedAt: machine.lastEvaluatedAt,
      },
      now,
    );
    if (decision === "FRESH") {
      await database.hardwareMachine.updateMany({
        where: {
          machineId,
          connectivity: "ONLINE",
          lastHeartbeatAt: machine.lastHeartbeatAt,
        },
        data: { offlineCandidateSince: null, lastEvaluatedAt: now },
      });
      return false;
    }
    if (decision === "START_CONFIRMATION" || decision === "WAIT") {
      await database.hardwareMachine.updateMany({
        where: {
          machineId,
          connectivity: "ONLINE",
          lastHeartbeatAt: machine.lastHeartbeatAt,
        },
        data: {
          offlineCandidateSince:
            decision === "START_CONFIRMATION" ? now : machine.offlineCandidateSince,
          lastEvaluatedAt: now,
        },
      });
      return false;
    }

    const claimed = await database.hardwareMachine.updateMany({
      where: {
        machineId,
        connectivity: "ONLINE",
        lastHeartbeatAt: machine.lastHeartbeatAt,
        offlineCandidateSince: machine.offlineCandidateSince,
        lastEvaluatedAt: machine.lastEvaluatedAt,
      },
      data: {
        connectivity: "OFFLINE",
        offlineSince: now,
        offlineCandidateSince: null,
        lastEvaluatedAt: now,
      },
    });
    if (claimed.count !== 1) return false;
    await createConnectivityAlert(database, {
      machineId,
      transition: "OFFLINE",
      detectedAt: now,
    });
    return true;
  });
}

export async function evaluateOfflineMachines(now = new Date()): Promise<number> {
  const candidates = await prisma.hardwareMachine.findMany({
    where: {
      connectivity: "ONLINE",
      lastHeartbeatAt: { lte: new Date(now.getTime() - OFFLINE_THRESHOLD_MS) },
    },
    select: { machineId: true },
  });
  let transitions = 0;
  for (const candidate of candidates) {
    if (await evaluateMachineOffline(candidate.machineId, now)) transitions += 1;
  }
  return transitions;
}

function providerErrorCode(error: OwnerReportDeliveryError): string {
  return error.statusCode === undefined ? error.code : `${error.code}_${error.statusCode}`;
}

export async function deliverPendingHardwareAlerts(
  provider: OwnerReportProvider = getMaintenanceAlertProvider(),
  now = new Date(),
): Promise<{ sent: number; failed: number; manualReview: number }> {
  const expiredBefore = new Date(now.getTime() - LINE_RETRY_KEY_VALIDITY_MS);
  const staleClaim = new Date(now.getTime() - HARDWARE_ALERT_CLAIM_STALE_MS);
  const expired = await prisma.hardwareAlertEvent.updateMany({
    where: {
      deliveryStatus: { in: ["PENDING", "FAILED", "SENDING"] },
      retryKeyCreatedAt: { lte: expiredBefore },
    },
    data: { deliveryStatus: "MANUAL_REVIEW", lastErrorCode: "RETRY_KEY_EXPIRED" },
  });
  const exhausted = await prisma.hardwareAlertEvent.updateMany({
    where: {
      deliveryStatus: { in: ["PENDING", "FAILED", "SENDING"] },
      attemptCount: { gte: HARDWARE_ALERT_MAX_ATTEMPTS },
    },
    data: { deliveryStatus: "MANUAL_REVIEW", lastErrorCode: "ATTEMPT_LIMIT_REACHED" },
  });
  const candidates = await prisma.hardwareAlertEvent.findMany({
    where: {
      retryKeyCreatedAt: { gt: expiredBefore },
      attemptCount: { lt: HARDWARE_ALERT_MAX_ATTEMPTS },
      OR: [
        { deliveryStatus: "PENDING" },
        { deliveryStatus: "FAILED", updatedAt: { lte: staleClaim } },
        { deliveryStatus: "SENDING", claimedAt: { lte: staleClaim } },
      ],
    },
    orderBy: [{ detectedAt: "asc" }, { id: "asc" }],
  });

  let sent = 0;
  let failed = 0;
  let manualReview = expired.count + exhausted.count;
  for (const event of candidates) {
    const claimed = await prisma.hardwareAlertEvent.updateMany({
      where: {
        id: event.id,
        deliveryStatus: event.deliveryStatus,
        attemptCount: event.attemptCount,
        claimedAt: event.claimedAt,
        retryKeyCreatedAt: { gt: expiredBefore },
      },
      data: {
        deliveryStatus: "SENDING",
        attemptCount: { increment: 1 },
        claimedAt: now,
        lastErrorCode: null,
      },
    });
    if (claimed.count !== 1) continue;
    const attemptCount = event.attemptCount + 1;
    let metadata: OwnerReportDeliveryMetadata;
    try {
      metadata = await provider.send(event.payloadSnapshot, event.retryKey);
    } catch (error: unknown) {
      const known = error instanceof OwnerReportDeliveryError;
      const retryable = known ? error.retryable : false;
      const errorCode = known ? providerErrorCode(error) : "UNKNOWN_DELIVERY_ERROR";
      const disposition = hardwareAlertFailureDisposition({
        retryable,
        attemptCount,
        retryKeyCreatedAt: event.retryKeyCreatedAt,
        now,
      });
      await prisma.hardwareAlertEvent.updateMany({
        where: { id: event.id, deliveryStatus: "SENDING", claimedAt: now },
        data: { deliveryStatus: disposition, lastErrorCode: errorCode },
      });
      if (disposition === "MANUAL_REVIEW") manualReview += 1;
      else failed += 1;
      continue;
    }
    const marked = await prisma.hardwareAlertEvent.updateMany({
      where: { id: event.id, deliveryStatus: "SENDING", claimedAt: now },
      data: {
        deliveryStatus: "SENT",
        sentAt: now,
        lineRequestId: metadata.requestId,
        lineAcceptedRequestId: metadata.acceptedRequestId,
        lastErrorCode: null,
      },
    });
    if (marked.count !== 1) {
      throw new Error("LINE accepted a hardware alert but its delivery claim was lost.");
    }
    sent += 1;
  }
  return { sent, failed, manualReview };
}

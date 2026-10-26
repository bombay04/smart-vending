import { randomUUID } from "node:crypto";
import type { Prisma } from "../../generated/prisma-client";
import { prisma } from "../lib/prisma";
import { buildOwnerReportFlexMessage, type OwnerReportFlexMessage } from "./owner-report-flex";
import {
  getOwnerReportProvider,
  OwnerReportDeliveryError,
  serializeOwnerReportPayload,
  type OwnerReportDeliveryMetadata,
  type OwnerReportProvider,
} from "./owner-line-report.provider";
import {
  aggregateSalesReport,
  getReportPeriod,
  type ReportPeriod,
  type ReportSourceTransaction,
  type SalesReport,
  type SalesReportDataMode,
  type SalesReportType,
} from "./sales-report";

export type DeliveryClaim =
  | { state: "NEEDS_PAYLOAD" }
  | {
      state: "CLAIMED";
      deliveryId: number;
      retryKey: string;
      payloadSnapshot: string;
    }
  | {
      state: "SENT" | "BUSY" | "MANUAL_REVIEW";
      payloadSnapshot: string;
    };

export interface OwnerReportStore {
  listTransactions(
    period: ReportPeriod,
    dataMode: SalesReportDataMode,
  ): Promise<ReportSourceTransaction[]>;
  claimDelivery(
    type: SalesReportType,
    dataMode: SalesReportDataMode,
    period: ReportPeriod,
    now: Date,
    newPayloadSnapshot?: string,
  ): Promise<DeliveryClaim>;
  markExpiredDeliveriesForManualReview(now: Date): Promise<number>;
  markDeliverySent(
    deliveryId: number,
    metadata: OwnerReportDeliveryMetadata,
    now: Date,
  ): Promise<void>;
  markDeliveryFailed(deliveryId: number, errorCode: string, retryable: boolean): Promise<void>;
}

export interface OwnerReportLogger {
  info(message: string, context: Record<string, unknown>): void;
  error(message: string, context: Record<string, unknown>): void;
}

export interface RunOwnerReportDependencies {
  store: OwnerReportStore;
  provider: OwnerReportProvider;
  now?: () => Date;
  logger?: OwnerReportLogger;
}

export interface RunOwnerReportOptions {
  send: boolean;
  dataMode?: SalesReportDataMode;
  asOf?: Date;
  demoEnabled?: boolean;
  scheduled?: boolean;
}

export interface OwnerReportRunResult {
  report: SalesReport | null;
  message: OwnerReportFlexMessage | null;
  delivery: "PREVIEW" | "SENT" | "ALREADY_SENT" | "BUSY" | "MANUAL_REVIEW";
}

export const DELIVERY_CLAIM_TTL_MS = 15 * 60 * 1_000;
export const LINE_RETRY_KEY_VALIDITY_MS = 24 * 60 * 60 * 1_000;

function decimalToSatang(amount: { toFixed(decimalPlaces: number): string }): number {
  const value = amount.toFixed(2);
  const match = /^(\d+)\.(\d{2})$/.exec(value);
  if (!match) throw new Error("Invalid transaction amount in report source.");
  const satang = Number(match[1]) * 100 + Number(match[2]);
  if (!Number.isSafeInteger(satang)) {
    throw new Error("Transaction amount is outside the supported report range.");
  }
  return satang;
}

async function claimPrismaDelivery(
  type: SalesReportType,
  dataMode: SalesReportDataMode,
  period: ReportPeriod,
  now: Date,
  newPayloadSnapshot?: string,
): Promise<DeliveryClaim> {
  const candidateRetryKey = newPayloadSnapshot === undefined ? undefined : randomUUID();
  try {
    return await prisma.$transaction(async (database) => {
      const existing = await database.salesReportDelivery.findUnique({
        where: {
          reportType_dataMode_periodStart: {
            reportType: type,
            dataMode,
            periodStart: period.start,
          },
        },
      });

      if (!existing) {
        if (newPayloadSnapshot === undefined || candidateRetryKey === undefined) {
          return { state: "NEEDS_PAYLOAD" };
        }
        const created = await database.salesReportDelivery.create({
          data: {
            reportType: type,
            dataMode,
            periodStart: period.start,
            periodEnd: period.end,
            claimedAt: now,
            retryKey: candidateRetryKey,
            retryKeyCreatedAt: now,
            payloadSnapshot: newPayloadSnapshot,
          },
        });
        return {
          state: "CLAIMED",
          deliveryId: created.id,
          retryKey: created.retryKey,
          payloadSnapshot: created.payloadSnapshot,
        };
      }

      if (existing.periodEnd.getTime() !== period.end.getTime()) {
        throw new Error("Report delivery period does not match its durable claim.");
      }
      if (existing.status === "SENT") {
        return { state: "SENT", payloadSnapshot: existing.payloadSnapshot };
      }
      if (existing.status === "MANUAL_REVIEW") {
        return { state: "MANUAL_REVIEW", payloadSnapshot: existing.payloadSnapshot };
      }

      const staleBefore = new Date(now.getTime() - DELIVERY_CLAIM_TTL_MS);
      if (existing.status === "SENDING" && existing.claimedAt.getTime() > staleBefore.getTime()) {
        return { state: "BUSY", payloadSnapshot: existing.payloadSnapshot };
      }

      const retryKeyExpiresAt = new Date(
        existing.retryKeyCreatedAt.getTime() + LINE_RETRY_KEY_VALIDITY_MS,
      );
      if (retryKeyExpiresAt.getTime() <= now.getTime()) {
        const reviewed = await database.salesReportDelivery.updateMany({
          where: {
            id: existing.id,
            status: existing.status,
            claimedAt: existing.claimedAt,
          },
          data: {
            status: "MANUAL_REVIEW",
            lastErrorCode: "RETRY_KEY_EXPIRED",
          },
        });
        if (reviewed.count === 1) {
          return { state: "MANUAL_REVIEW", payloadSnapshot: existing.payloadSnapshot };
        }
        throw new Error("Owner report delivery claim changed while checking retry-key expiry.");
      }

      const claimed = await database.salesReportDelivery.updateMany({
        where: {
          id: existing.id,
          OR: [{ status: "FAILED" }, { status: "SENDING", claimedAt: { lte: staleBefore } }],
        },
        data: {
          status: "SENDING",
          attemptCount: { increment: 1 },
          claimedAt: now,
          lastErrorCode: null,
        },
      });
      return claimed.count === 1
        ? {
            state: "CLAIMED",
            deliveryId: existing.id,
            retryKey: existing.retryKey,
            payloadSnapshot: existing.payloadSnapshot,
          }
        : { state: "BUSY", payloadSnapshot: existing.payloadSnapshot };
    });
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      return claimPrismaDelivery(type, dataMode, period, now);
    }
    throw error;
  }
}

export const prismaOwnerReportStore: OwnerReportStore = {
  async listTransactions(period, dataMode) {
    const modeWhere: Prisma.TransactionWhereInput =
      dataMode === "LIVE"
        ? {
            providerLiveMode: true,
            NOT: { providerChargeId: { startsWith: "chrg_test_", mode: "insensitive" } },
          }
        : {
            providerLiveMode: false,
            providerChargeId: { startsWith: "chrg_test_", mode: "insensitive" },
          };
    const transactions = await prisma.transaction.findMany({
      where: {
        paidAt: { gte: period.start, lt: period.end },
        paymentStatus: "SUCCESS",
        customerCancelledAt: null,
        providerChargeId: { not: null },
        AND: [{ OR: [{ providerStatus: "successful" }, { providerStatus: null }] }, modeWhere],
      },
      select: {
        id: true,
        productId: true,
        productNameSnapshot: true,
        amount: true,
        paidAt: true,
        paymentStatus: true,
        providerStatus: true,
        providerLiveMode: true,
        providerChargeId: true,
        customerCancelledAt: true,
        product: { select: { name: true } },
      },
      orderBy: [{ paidAt: "asc" }, { id: "asc" }],
    });

    return transactions.map((transaction) => ({
      id: transaction.id,
      productId: transaction.productId,
      productName:
        transaction.productNameSnapshot?.trim() ||
        transaction.product.name.trim() ||
        `สินค้า #${transaction.productId}`,
      amountSatang: decimalToSatang(transaction.amount),
      paidAt: transaction.paidAt,
      paymentStatus: transaction.paymentStatus,
      providerStatus: transaction.providerStatus,
      providerLiveMode: transaction.providerLiveMode,
      providerChargeId: transaction.providerChargeId,
      customerCancelledAt: transaction.customerCancelledAt,
    }));
  },

  claimDelivery: claimPrismaDelivery,

  async markExpiredDeliveriesForManualReview(now) {
    const expiredBefore = new Date(now.getTime() - LINE_RETRY_KEY_VALIDITY_MS);
    const result = await prisma.salesReportDelivery.updateMany({
      where: {
        status: { in: ["SENDING", "FAILED"] },
        retryKeyCreatedAt: { lte: expiredBefore },
      },
      data: {
        status: "MANUAL_REVIEW",
        lastErrorCode: "RETRY_KEY_EXPIRED",
      },
    });
    return result.count;
  },

  async markDeliverySent(deliveryId, metadata, now) {
    const result = await prisma.salesReportDelivery.updateMany({
      where: { id: deliveryId, status: "SENDING" },
      data: {
        status: "SENT",
        sentAt: now,
        lineRequestId: metadata.requestId,
        lineAcceptedRequestId: metadata.acceptedRequestId,
        lastErrorCode: null,
      },
    });
    if (result.count !== 1) throw new Error("Owner report delivery claim was lost.");
  },

  async markDeliveryFailed(deliveryId, errorCode, retryable) {
    await prisma.salesReportDelivery.updateMany({
      where: { id: deliveryId, status: "SENDING" },
      data: {
        status: retryable ? "FAILED" : "MANUAL_REVIEW",
        lastErrorCode: errorCode,
      },
    });
  },
};

const defaultLogger: OwnerReportLogger = {
  info(message, context) {
    console.info(message, context);
  },
  error(message, context) {
    console.error(message, context);
  },
};

function logContext(
  type: SalesReportType,
  dataMode: SalesReportDataMode,
  period: ReportPeriod,
): Record<string, unknown> {
  return {
    reportType: type,
    dataMode,
    periodStart: period.start.toISOString(),
    periodEnd: period.end.toISOString(),
  };
}

function messageFromPayloadSnapshot(payloadSnapshot: string): OwnerReportFlexMessage {
  const parsed: unknown = JSON.parse(payloadSnapshot);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("messages" in parsed) ||
    !Array.isArray(parsed.messages) ||
    parsed.messages.length !== 1
  ) {
    throw new Error("Stored owner report payload is invalid.");
  }
  return parsed.messages[0] as OwnerReportFlexMessage;
}

function providerErrorCode(error: OwnerReportDeliveryError): string {
  return error.statusCode === undefined ? error.code : `${error.code}_${error.statusCode}`;
}

export async function runOwnerReportWithDependencies(
  type: SalesReportType,
  options: RunOwnerReportOptions,
  dependencies: RunOwnerReportDependencies,
): Promise<OwnerReportRunResult> {
  const now = dependencies.now?.() ?? new Date();
  const dataMode = options.dataMode ?? "LIVE";
  if (dataMode === "DEMO_TEST" && options.demoEnabled !== true) {
    throw new Error("DEMO_TEST reports require OWNER_REPORT_DEMO_ENABLED=true.");
  }
  const logger = dependencies.logger ?? defaultLogger;
  const period = getReportPeriod(type, options.asOf ?? now);
  const context = {
    ...logContext(type, dataMode, period),
    scheduled: options.scheduled === true,
  };

  if (!options.send) {
    const transactions = await dependencies.store.listTransactions(period, dataMode);
    const report = aggregateSalesReport(type, transactions, period, dataMode);
    const message = buildOwnerReportFlexMessage(report, {
      scheduled: options.scheduled === true,
    });
    logger.info("Owner sales report preview generated.", context);
    return { report, message, delivery: "PREVIEW" };
  }

  const expiredDeliveryCount = await dependencies.store.markExpiredDeliveriesForManualReview(now);
  if (expiredDeliveryCount > 0) {
    logger.error("Expired owner report deliveries require manual review.", {
      ...context,
      expiredDeliveryCount,
    });
  }

  let report: SalesReport | null = null;
  let claim = await dependencies.store.claimDelivery(type, dataMode, period, now);
  if (claim.state === "NEEDS_PAYLOAD") {
    const transactions = await dependencies.store.listTransactions(period, dataMode);
    report = aggregateSalesReport(type, transactions, period, dataMode);
    const newMessage = buildOwnerReportFlexMessage(report, {
      scheduled: options.scheduled === true,
    });
    claim = await dependencies.store.claimDelivery(
      type,
      dataMode,
      period,
      now,
      serializeOwnerReportPayload(newMessage),
    );
  }

  if (claim.state === "NEEDS_PAYLOAD") {
    throw new Error("Owner report delivery could not persist its payload snapshot.");
  }

  const message = messageFromPayloadSnapshot(claim.payloadSnapshot);
  if (claim.state !== "CLAIMED") {
    logger.info("Owner sales report delivery skipped.", { ...context, reason: claim.state });
    return {
      report: null,
      message,
      delivery:
        claim.state === "SENT"
          ? "ALREADY_SENT"
          : claim.state === "MANUAL_REVIEW"
            ? "MANUAL_REVIEW"
            : "BUSY",
    };
  }

  let metadata: OwnerReportDeliveryMetadata;
  try {
    metadata = await dependencies.provider.send(claim.payloadSnapshot, claim.retryKey);
  } catch (error: unknown) {
    const deliveryError =
      error instanceof OwnerReportDeliveryError
        ? error
        : new OwnerReportDeliveryError("NETWORK_ERROR", undefined, true);
    const errorCode = providerErrorCode(deliveryError);
    await dependencies.store.markDeliveryFailed(
      claim.deliveryId,
      errorCode,
      deliveryError.retryable,
    );
    logger.error("Owner sales report delivery failed.", {
      ...context,
      errorCode,
      retryable: deliveryError.retryable,
    });
    throw error;
  }

  try {
    await dependencies.store.markDeliverySent(claim.deliveryId, metadata, now);
  } catch (error: unknown) {
    logger.error("Owner sales report was accepted by LINE but state persistence failed.", {
      ...context,
      lineStatus: metadata.status,
      lineRequestId: metadata.requestId,
      lineAcceptedRequestId: metadata.acceptedRequestId,
    });
    throw error;
  }

  logger.info("Owner sales report delivered.", {
    ...context,
    lineStatus: metadata.status,
    lineRequestId: metadata.requestId,
    lineAcceptedRequestId: metadata.acceptedRequestId,
  });
  return { report, message, delivery: "SENT" };
}

export function runOwnerReport(
  type: SalesReportType,
  options: RunOwnerReportOptions,
): Promise<OwnerReportRunResult> {
  return runOwnerReportWithDependencies(type, options, {
    store: prismaOwnerReportStore,
    provider: getOwnerReportProvider(),
  });
}

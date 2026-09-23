import type { PaymentStatus, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { getPaymentProvider } from "../payments/omise-payment.provider";
import {
  type PaymentProvider,
  PaymentProviderError,
  type ProviderPayment,
} from "../payments/payment-provider";
import { HttpError } from "../utils/http-error";

export interface PaymentRecord {
  id: number;
  slotId: number;
  slotNumber: number;
  slotStatus: "AVAILABLE" | "SOLD_OUT";
  productId: number;
  productName: string;
  amount: string;
  paymentStatus: PaymentStatus;
  providerChargeId: string | null;
  providerStatus: string | null;
  expiresAt: Date | null;
  paidAt: Date | null;
}

export interface SaveProviderPaymentInput {
  chargeId: string;
  providerStatus: string;
  expiresAt: Date | null;
}

export interface PaymentStore {
  createPendingPayment(slotNumber: number): Promise<PaymentRecord>;
  saveProviderPayment(
    transactionId: number,
    payment: SaveProviderPaymentInput,
  ): Promise<PaymentRecord>;
  markProviderCreationFailed(transactionId: number): Promise<void>;
  findPayment(transactionId: number): Promise<PaymentRecord | null>;
  findPaymentByProviderChargeId(providerChargeId: string): Promise<PaymentRecord | null>;
  applyProviderStatus(transactionId: number, payment: ProviderPayment): Promise<PaymentRecord>;
}

type TransactionWithRelations = Prisma.TransactionGetPayload<{
  include: { slot: true; product: true };
}>;

function toPaymentRecord(transaction: TransactionWithRelations): PaymentRecord {
  return {
    id: transaction.id,
    slotId: transaction.slotId,
    slotNumber: transaction.slot.slotNumber,
    slotStatus: transaction.slot.status,
    productId: transaction.productId,
    productName: transaction.product.name,
    amount: transaction.amount.toFixed(2),
    paymentStatus: transaction.paymentStatus,
    providerChargeId: transaction.providerChargeId,
    providerStatus: transaction.providerStatus,
    expiresAt: transaction.expiresAt,
    paidAt: transaction.paidAt,
  };
}

async function withSerializableRetry<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error: unknown) {
      if (
        attempt < 2 &&
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "P2034"
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new Error("Unreachable serializable transaction retry state.");
}

const prismaPaymentStore: PaymentStore = {
  async createPendingPayment(slotNumber) {
    return withSerializableRetry(() =>
      prisma.$transaction(
        async (database) => {
          const slot = await database.slot.findUnique({
            where: { slotNumber },
            include: { product: true },
          });

          if (!slot) {
            throw new HttpError("Slot not found.", 404);
          }
          if (!slot.product || !slot.product.isActive) {
            throw new HttpError("Slot has no available product.", 400);
          }
          if (slot.status === "SOLD_OUT") {
            throw new HttpError("Slot is sold out.", 409);
          }

          const pendingPayment = await database.transaction.findFirst({
            where: { slotId: slot.id, paymentStatus: "PENDING" },
            select: { id: true },
          });
          if (pendingPayment) {
            throw new HttpError("A payment is already pending for this slot.", 409);
          }

          const payment = await database.transaction.create({
            data: {
              slotId: slot.id,
              productId: slot.product.id,
              amount: slot.product.price,
              paymentStatus: "PENDING",
              paymentProvider: "OPN",
            },
            include: { slot: true, product: true },
          });

          return toPaymentRecord(payment);
        },
        { isolationLevel: "Serializable" },
      ),
    );
  },

  async saveProviderPayment(transactionId, payment) {
    const updated = await prisma.transaction.update({
      where: { id: transactionId },
      data: {
        providerChargeId: payment.chargeId,
        providerStatus: payment.providerStatus,
        expiresAt: payment.expiresAt,
      },
      include: { slot: true, product: true },
    });
    return toPaymentRecord(updated);
  },

  async markProviderCreationFailed(transactionId) {
    await prisma.transaction.updateMany({
      where: { id: transactionId, paymentStatus: "PENDING", providerChargeId: null },
      data: { paymentStatus: "FAILED", providerStatus: "creation_failed" },
    });
  },

  async findPayment(transactionId) {
    const payment = await prisma.transaction.findUnique({
      where: { id: transactionId },
      include: { slot: true, product: true },
    });
    return payment ? toPaymentRecord(payment) : null;
  },

  async findPaymentByProviderChargeId(providerChargeId) {
    const payment = await prisma.transaction.findUnique({
      where: { providerChargeId },
      include: { slot: true, product: true },
    });
    return payment ? toPaymentRecord(payment) : null;
  },

  async applyProviderStatus(transactionId, providerPayment) {
    return withSerializableRetry(() =>
      prisma.$transaction(
        async (database) => {
          const current = await database.transaction.findUnique({
            where: { id: transactionId },
            include: { slot: true, product: true },
          });
          if (!current) {
            throw new HttpError("Transaction not found.", 404);
          }

          if (current.paymentStatus === "SUCCESS") {
            return toPaymentRecord(current);
          }

          let paymentStatus: PaymentStatus = current.paymentStatus;
          if (providerPayment.status === "successful") {
            paymentStatus = "SUCCESS";
          } else if (providerPayment.status === "failed") {
            paymentStatus = "FAILED";
          } else if (providerPayment.status === "expired") {
            paymentStatus = "EXPIRED";
          }

          await database.transaction.update({
            where: { id: transactionId },
            data: {
              paymentStatus,
              providerStatus: providerPayment.status,
              expiresAt: providerPayment.expiresAt
                ? new Date(providerPayment.expiresAt)
                : current.expiresAt,
              paidAt: paymentStatus === "SUCCESS" ? new Date() : current.paidAt,
            },
          });

          if (paymentStatus === "SUCCESS") {
            await database.slot.update({
              where: { id: current.slotId },
              data: { status: "SOLD_OUT" },
            });
          }

          const updated = await database.transaction.findUniqueOrThrow({
            where: { id: transactionId },
            include: { slot: true, product: true },
          });
          return toPaymentRecord(updated);
        },
        { isolationLevel: "Serializable" },
      ),
    );
  },
};

export function thbAmountToSatang(amount: string): number {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(amount);
  if (!match) {
    throw new Error("Invalid THB decimal amount.");
  }

  const baht = Number(match[1]);
  const satang = Number((match[2] ?? "").padEnd(2, "0"));
  const total = baht * 100 + satang;
  if (!Number.isSafeInteger(total) || total <= 0) {
    throw new Error("THB amount is outside the supported range.");
  }

  return total;
}

function toSafePaymentResponse(payment: PaymentRecord, qrImageUrl?: string | null) {
  return {
    transactionId: payment.id,
    slotNumber: payment.slotNumber,
    productName: payment.productName,
    amount: payment.amount,
    paymentStatus: payment.paymentStatus,
    slotStatus: payment.slotStatus,
    qrImageUrl: qrImageUrl ?? undefined,
    expiresAt: payment.expiresAt?.toISOString() ?? null,
    paidAt: payment.paidAt?.toISOString() ?? null,
  };
}

function validateProviderPayment(payment: PaymentRecord, providerPayment: ProviderPayment): void {
  if (payment.providerChargeId !== providerPayment.chargeId) {
    throw new PaymentProviderError("Payment provider returned a mismatched charge.");
  }
  if (
    providerPayment.currency !== "THB" ||
    providerPayment.amount !== thbAmountToSatang(payment.amount)
  ) {
    throw new PaymentProviderError("Payment provider returned mismatched payment details.");
  }
  if (providerPayment.status === "successful" && !providerPayment.paid) {
    throw new PaymentProviderError("Payment provider returned an inconsistent payment status.");
  }
}

async function reconcilePaymentRecord(
  payment: PaymentRecord,
  store: PaymentStore,
  provider: PaymentProvider,
) {
  if (payment.paymentStatus !== "PENDING") {
    return toSafePaymentResponse(payment);
  }
  if (!payment.providerChargeId) {
    throw new HttpError("Payment is not ready for verification.", 503);
  }

  const providerPayment = await provider.retrievePayment(payment.providerChargeId);
  validateProviderPayment(payment, providerPayment);
  const updated = await store.applyProviderStatus(payment.id, providerPayment);
  return toSafePaymentResponse(updated, providerPayment.qrImageUrl);
}

export async function createPromptPayPaymentWithDependencies(
  slotNumber: number,
  store: PaymentStore,
  provider: PaymentProvider,
) {
  const pendingPayment = await store.createPendingPayment(slotNumber);
  const amount = thbAmountToSatang(pendingPayment.amount);
  if (amount < 2_000 || amount > 15_000_000) {
    await store.markProviderCreationFailed(pendingPayment.id);
    throw new HttpError("This product price is not supported by PromptPay.", 422);
  }

  let providerPayment: ProviderPayment;
  try {
    providerPayment = await provider.createPromptPayPayment({
      amount,
      localTransactionId: pendingPayment.id,
      description: `Smart Vending: ${pendingPayment.productName} (slot ${pendingPayment.slotNumber})`,
    });
  } catch {
    await store.markProviderCreationFailed(pendingPayment.id);
    throw new HttpError("Unable to create payment. Please try again.", 502);
  }

  const saved = await store.saveProviderPayment(pendingPayment.id, {
    chargeId: providerPayment.chargeId,
    providerStatus: providerPayment.status,
    expiresAt: providerPayment.expiresAt ? new Date(providerPayment.expiresAt) : null,
  });
  validateProviderPayment(saved, providerPayment);

  const finalPayment =
    providerPayment.status === "pending"
      ? saved
      : await store.applyProviderStatus(saved.id, providerPayment);
  return toSafePaymentResponse(finalPayment, providerPayment.qrImageUrl);
}

export function createPromptPayPayment(slotNumber: number) {
  return createPromptPayPaymentWithDependencies(
    slotNumber,
    prismaPaymentStore,
    getPaymentProvider(),
  );
}

export async function getPaymentStatusWithDependencies(
  transactionId: number,
  store: PaymentStore,
  provider: PaymentProvider,
) {
  const payment = await store.findPayment(transactionId);
  if (!payment) {
    throw new HttpError("Transaction not found.", 404);
  }

  try {
    return await reconcilePaymentRecord(payment, store, provider);
  } catch (error: unknown) {
    if (error instanceof HttpError) {
      throw error;
    }
    throw new HttpError("Unable to verify payment status. Please wait and try again.", 502);
  }
}

export function getPaymentStatus(transactionId: number) {
  return getPaymentStatusWithDependencies(transactionId, prismaPaymentStore, getPaymentProvider());
}

export async function reconcileWebhookChargeWithDependencies(
  providerChargeId: string,
  store: PaymentStore,
  provider: PaymentProvider,
) {
  const payment = await store.findPaymentByProviderChargeId(providerChargeId);
  if (!payment || payment.paymentStatus !== "PENDING") {
    return { processed: false };
  }

  await reconcilePaymentRecord(payment, store, provider);
  return { processed: true };
}

export function reconcileWebhookCharge(providerChargeId: string) {
  return reconcileWebhookChargeWithDependencies(
    providerChargeId,
    prismaPaymentStore,
    getPaymentProvider(),
  );
}

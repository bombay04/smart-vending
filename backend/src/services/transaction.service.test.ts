import assert from "node:assert/strict";
import test from "node:test";
import type {
  CreateProviderPaymentInput,
  PaymentProvider,
  ProviderPayment,
} from "../payments/payment-provider";
import { HttpError } from "../utils/http-error";
import {
  createPromptPayPaymentWithDependencies,
  getPaymentStatusWithDependencies,
  type PaymentRecord,
  type PaymentStore,
  reconcileWebhookChargeWithDependencies,
  thbAmountToSatang,
} from "./transaction.service";

const providerPending: ProviderPayment = {
  chargeId: "chrg_test_abc123",
  status: "pending",
  amount: 2000,
  currency: "THB",
  paid: false,
  qrImageUrl: "https://api.omise.co/qr/test",
  expiresAt: "2026-09-23T10:00:00.000Z",
};

function baseRecord(overrides: Partial<PaymentRecord> = {}): PaymentRecord {
  return {
    id: 91,
    slotId: 1,
    slotNumber: 1,
    slotStatus: "AVAILABLE",
    productId: 7,
    productName: "Authoritative Tissue",
    amount: "20.00",
    paymentStatus: "PENDING",
    providerChargeId: null,
    providerStatus: null,
    expiresAt: null,
    paidAt: null,
    ...overrides,
  };
}

class MemoryStore implements PaymentStore {
  record: PaymentRecord | null;
  savedProviderChargeId: string | null = null;
  creationFailed = false;
  applyCount = 0;
  createdSlotNumber: number | null = null;

  constructor(record: PaymentRecord | null = baseRecord()) {
    this.record = record;
  }

  async createPendingPayment(slotNumber: number) {
    this.createdSlotNumber = slotNumber;
    if (!this.record) throw new HttpError("Slot not found.", 404);
    if (this.record.slotStatus === "SOLD_OUT") throw new HttpError("Slot is sold out.", 409);
    return { ...this.record };
  }

  async saveProviderPayment(
    transactionId: number,
    payment: { chargeId: string; providerStatus: string; expiresAt: Date | null },
  ) {
    assert.equal(transactionId, this.record?.id);
    this.savedProviderChargeId = payment.chargeId;
    this.record = {
      ...this.record!,
      providerChargeId: payment.chargeId,
      providerStatus: payment.providerStatus,
      expiresAt: payment.expiresAt,
    };
    return { ...this.record };
  }

  async markProviderCreationFailed() {
    this.creationFailed = true;
    if (this.record) {
      this.record = { ...this.record, paymentStatus: "FAILED", providerStatus: "creation_failed" };
    }
  }

  async findPayment(transactionId: number) {
    return this.record?.id === transactionId ? { ...this.record } : null;
  }

  async findPaymentByProviderChargeId(providerChargeId: string) {
    return this.record?.providerChargeId === providerChargeId ? { ...this.record } : null;
  }

  async applyProviderStatus(_transactionId: number, payment: ProviderPayment) {
    assert.ok(this.record);
    if (this.record.paymentStatus === "SUCCESS") return { ...this.record };
    this.applyCount += 1;
    const paymentStatus =
      payment.status === "successful"
        ? "SUCCESS"
        : payment.status === "failed"
          ? "FAILED"
          : payment.status === "expired"
            ? "EXPIRED"
            : "PENDING";
    this.record = {
      ...this.record,
      paymentStatus,
      providerStatus: payment.status,
      slotStatus: paymentStatus === "SUCCESS" ? "SOLD_OUT" : this.record.slotStatus,
      paidAt: paymentStatus === "SUCCESS" ? new Date("2026-09-23T09:00:00Z") : null,
    };
    return { ...this.record };
  }
}

class MockProvider implements PaymentProvider {
  createInput: CreateProviderPaymentInput | null = null;
  retrieveCount = 0;

  constructor(
    private createResult: ProviderPayment = providerPending,
    private retrieveResult: ProviderPayment = providerPending,
    private createError: Error | null = null,
  ) {}

  async createPromptPayPayment(input: CreateProviderPaymentInput) {
    this.createInput = input;
    if (this.createError) throw this.createError;
    return this.createResult;
  }

  async retrievePayment() {
    this.retrieveCount += 1;
    return this.retrieveResult;
  }
}

test("THB decimals convert to satang without floating-point arithmetic", () => {
  assert.equal(thbAmountToSatang("20.00"), 2000);
  assert.equal(thbAmountToSatang("20.5"), 2050);
  assert.equal(thbAmountToSatang("0.01"), 1);
  assert.throws(() => thbAmountToSatang("20.001"));
});

test("payment creation uses backend slot, product, and price and starts pending", async () => {
  const store = new MemoryStore();
  const provider = new MockProvider();
  const result = await createPromptPayPaymentWithDependencies(1, store, provider);

  assert.equal(store.createdSlotNumber, 1);
  assert.deepEqual(provider.createInput, {
    amount: 2000,
    localTransactionId: 91,
    description: "Smart Vending: Authoritative Tissue (slot 1)",
  });
  assert.equal(result.paymentStatus, "PENDING");
  assert.equal(result.qrImageUrl, providerPending.qrImageUrl);
  assert.equal(store.savedProviderChargeId, providerPending.chargeId);
  assert.equal("providerChargeId" in result, false);
  assert.equal(JSON.stringify(result).includes("skey_"), false);
});

test("provider creation failure marks the local payment failed and returns a safe error", async () => {
  const store = new MemoryStore();
  const provider = new MockProvider(providerPending, providerPending, new Error("secret detail"));
  await assert.rejects(
    createPromptPayPaymentWithDependencies(1, store, provider),
    (error: unknown) =>
      error instanceof HttpError &&
      error.statusCode === 502 &&
      !error.message.includes("secret detail"),
  );
  assert.equal(store.creationFailed, true);
});

test("prices outside Opn PromptPay limits fail before calling the provider", async () => {
  const store = new MemoryStore(baseRecord({ amount: "19.99" }));
  const provider = new MockProvider();
  await assert.rejects(
    createPromptPayPaymentWithDependencies(1, store, provider),
    (error: unknown) => error instanceof HttpError && error.statusCode === 422,
  );
  assert.equal(store.creationFailed, true);
  assert.equal(provider.createInput, null);
});

test("provider pending status remains pending and does not sell out the slot", async () => {
  const store = new MemoryStore(baseRecord({ providerChargeId: providerPending.chargeId }));
  const result = await getPaymentStatusWithDependencies(91, store, new MockProvider());
  assert.equal(result.paymentStatus, "PENDING");
  assert.equal(result.slotStatus, "AVAILABLE");
});

test("provider success immediately completes the sale and marks the slot sold out", async () => {
  const success: ProviderPayment = { ...providerPending, status: "successful", paid: true };
  const store = new MemoryStore(baseRecord({ providerChargeId: success.chargeId }));
  const result = await getPaymentStatusWithDependencies(
    91,
    store,
    new MockProvider(providerPending, success),
  );
  assert.equal(result.paymentStatus, "SUCCESS");
  assert.equal(result.slotStatus, "SOLD_OUT");
  assert.ok(result.paidAt);
});

test("repeated success polling is idempotent", async () => {
  const success: ProviderPayment = { ...providerPending, status: "successful", paid: true };
  const store = new MemoryStore(baseRecord({ providerChargeId: success.chargeId }));
  const provider = new MockProvider(providerPending, success);
  await getPaymentStatusWithDependencies(91, store, provider);
  await getPaymentStatusWithDependencies(91, store, provider);
  assert.equal(store.applyCount, 1);
  assert.equal(provider.retrieveCount, 1);
});

test("failed and expired provider payments never sell out the slot", async () => {
  for (const status of ["failed", "expired"] as const) {
    const providerPayment = { ...providerPending, status };
    const store = new MemoryStore(baseRecord({ providerChargeId: providerPayment.chargeId }));
    const result = await getPaymentStatusWithDependencies(
      91,
      store,
      new MockProvider(providerPending, providerPayment),
    );
    assert.equal(result.paymentStatus, status === "failed" ? "FAILED" : "EXPIRED");
    assert.equal(result.slotStatus, "AVAILABLE");
  }
});

test("unknown transactions are rejected", async () => {
  await assert.rejects(
    getPaymentStatusWithDependencies(404, new MemoryStore(null), new MockProvider()),
    (error: unknown) => error instanceof HttpError && error.statusCode === 404,
  );
});

test("a sold-out slot cannot begin a purchase", async () => {
  await assert.rejects(
    createPromptPayPaymentWithDependencies(
      1,
      new MemoryStore(baseRecord({ slotStatus: "SOLD_OUT" })),
      new MockProvider(),
    ),
    (error: unknown) => error instanceof HttpError && error.statusCode === 409,
  );
});

test("mismatched or inconsistent provider success fails safely", async () => {
  const malformed = { ...providerPending, status: "successful" as const, paid: false };
  const store = new MemoryStore(baseRecord({ providerChargeId: malformed.chargeId }));
  await assert.rejects(
    getPaymentStatusWithDependencies(91, store, new MockProvider(providerPending, malformed)),
    (error: unknown) => error instanceof HttpError && error.statusCode === 502,
  );
  assert.equal(store.record?.paymentStatus, "PENDING");
  assert.equal(store.record?.slotStatus, "AVAILABLE");
});

test("duplicate provider notifications do not duplicate sale completion", async () => {
  const success: ProviderPayment = { ...providerPending, status: "successful", paid: true };
  const store = new MemoryStore(baseRecord({ providerChargeId: success.chargeId }));
  const provider = new MockProvider(providerPending, success);
  assert.deepEqual(
    await reconcileWebhookChargeWithDependencies(success.chargeId, store, provider),
    { processed: true },
  );
  assert.deepEqual(
    await reconcileWebhookChargeWithDependencies(success.chargeId, store, provider),
    { processed: false },
  );
  assert.equal(store.applyCount, 1);
});

import assert from "node:assert/strict";
import test from "node:test";
import type { OwnerReportFlexMessage } from "./owner-report-flex";
import {
  type DeliveryClaim,
  type OwnerReportStore,
  runOwnerReportWithDependencies,
} from "./owner-report.service";
import {
  OwnerReportDeliveryError,
  serializeOwnerReportPayload,
  type OwnerReportDeliveryMetadata,
  type OwnerReportProvider,
} from "./owner-line-report.provider";
import type {
  ReportPeriod,
  ReportSourceTransaction,
  SalesReportDataMode,
  SalesReportType,
} from "./sales-report";

class MemoryReportStore implements OwnerReportStore {
  transactions: ReportSourceTransaction[] = [];
  state: "EMPTY" | "SENDING" | "SENT" | "FAILED" | "MANUAL_REVIEW" = "EMPTY";
  claimCount = 0;
  failedCodes: Array<{ code: string; retryable: boolean }> = [];
  sentMetadata: OwnerReportDeliveryMetadata[] = [];
  retryKey = "retry-key-7";
  retryKeyCreatedAt = new Date("2026-10-23T00:00:00Z");
  claimedAt = new Date("2026-10-23T00:00:00Z");
  payloadSnapshot?: string;
  dataMode?: SalesReportDataMode;
  failMarkSent = false;

  async listTransactions(_period: ReportPeriod, _dataMode: SalesReportDataMode) {
    void _period;
    void _dataMode;
    return this.transactions;
  }

  async claimDelivery(
    _type: SalesReportType,
    dataMode: SalesReportDataMode,
    _period: ReportPeriod,
    now: Date,
    newPayloadSnapshot?: string,
  ): Promise<DeliveryClaim> {
    this.claimCount += 1;
    if (this.state === "EMPTY" && newPayloadSnapshot === undefined)
      return { state: "NEEDS_PAYLOAD" };
    if (this.state === "EMPTY") {
      this.payloadSnapshot = newPayloadSnapshot;
      this.dataMode = dataMode;
      this.retryKeyCreatedAt = now;
      this.claimedAt = now;
      this.state = "SENDING";
      return {
        state: "CLAIMED",
        deliveryId: 7,
        retryKey: this.retryKey,
        payloadSnapshot: this.payloadSnapshot!,
      };
    }
    if (this.state === "SENT") return { state: "SENT", payloadSnapshot: this.payloadSnapshot! };
    if (this.state === "MANUAL_REVIEW") {
      return { state: "MANUAL_REVIEW", payloadSnapshot: this.payloadSnapshot! };
    }
    if (this.state === "SENDING" && now.getTime() - this.claimedAt.getTime() < 15 * 60 * 1_000) {
      return { state: "BUSY", payloadSnapshot: this.payloadSnapshot! };
    }
    if (now.getTime() - this.retryKeyCreatedAt.getTime() >= 24 * 60 * 60 * 1_000) {
      this.state = "MANUAL_REVIEW";
      return { state: "MANUAL_REVIEW", payloadSnapshot: this.payloadSnapshot! };
    }
    this.state = "SENDING";
    this.claimedAt = now;
    return {
      state: "CLAIMED",
      deliveryId: 7,
      retryKey: this.retryKey,
      payloadSnapshot: this.payloadSnapshot!,
    };
  }

  async markExpiredDeliveriesForManualReview(now: Date) {
    if (
      (this.state === "SENDING" || this.state === "FAILED") &&
      now.getTime() - this.retryKeyCreatedAt.getTime() >= 24 * 60 * 60 * 1_000
    ) {
      this.state = "MANUAL_REVIEW";
      return 1;
    }
    return 0;
  }

  async markDeliverySent(deliveryId: number, metadata: OwnerReportDeliveryMetadata) {
    void deliveryId;
    if (this.failMarkSent) throw new Error("database unavailable");
    this.state = "SENT";
    this.sentMetadata.push(metadata);
  }

  async markDeliveryFailed(deliveryId: number, errorCode: string, retryable: boolean) {
    void deliveryId;
    this.state = retryable ? "FAILED" : "MANUAL_REVIEW";
    this.failedCodes.push({ code: errorCode, retryable });
  }
}

class MemoryProvider implements OwnerReportProvider {
  payloads: string[] = [];
  retryKeys: string[] = [];
  error?: Error;

  async send(payloadSnapshot: string, retryKey: string) {
    this.payloads.push(payloadSnapshot);
    this.retryKeys.push(retryKey);
    if (this.error) throw this.error;
    return {
      status: 200,
      requestId: "line-request-7",
      acceptedRequestId: null,
      duplicateAccepted: false,
    };
  }
}

const silentLogger = {
  info(message: string, context: Record<string, unknown>) {
    void message;
    void context;
  },
  error(message: string, context: Record<string, unknown>) {
    void message;
    void context;
  },
};

const storedMessage: OwnerReportFlexMessage = {
  type: "flex",
  altText: "stored report",
  contents: { type: "bubble" },
};

test("preview generates a payload without claiming or contacting LINE", async () => {
  const store = new MemoryReportStore();
  const provider = new MemoryProvider();
  const result = await runOwnerReportWithDependencies(
    "DAILY",
    { send: false },
    {
      store,
      provider,
      now: () => new Date("2026-10-23T01:00:00Z"),
      logger: silentLogger,
    },
  );
  assert.equal(result.delivery, "PREVIEW");
  assert.equal(store.claimCount, 0);
  assert.equal(provider.payloads.length, 0);
});

test("durable period claim prevents a second owner report delivery", async () => {
  const store = new MemoryReportStore();
  const provider = new MemoryProvider();
  const dependencies = {
    store,
    provider,
    now: () => new Date("2026-10-23T01:00:00Z"),
    logger: silentLogger,
  };
  const first = await runOwnerReportWithDependencies("DAILY", { send: true }, dependencies);
  const second = await runOwnerReportWithDependencies("DAILY", { send: true }, dependencies);
  assert.equal(first.delivery, "SENT");
  assert.equal(second.delivery, "ALREADY_SENT");
  assert.equal(provider.payloads.length, 1);
  assert.deepEqual(store.sentMetadata, [
    {
      status: 200,
      requestId: "line-request-7",
      acceptedRequestId: null,
      duplicateAccepted: false,
    },
  ]);
});

test("active delivery claim suppresses an overlapping scheduler run", async () => {
  const store = new MemoryReportStore();
  store.state = "SENDING";
  store.payloadSnapshot = serializeOwnerReportPayload(storedMessage);
  store.claimedAt = new Date("2026-10-26T01:00:00Z");
  store.retryKeyCreatedAt = new Date("2026-10-26T01:00:00Z");
  const provider = new MemoryProvider();
  const result = await runOwnerReportWithDependencies(
    "WEEKLY",
    { send: true },
    {
      store,
      provider,
      now: () => new Date("2026-10-26T01:00:00Z"),
      logger: silentLogger,
    },
  );
  assert.equal(result.delivery, "BUSY");
  assert.equal(provider.payloads.length, 0);
});

test("LINE failure marks the attempt failed and permits a later job retry", async () => {
  const store = new MemoryReportStore();
  const provider = new MemoryProvider();
  provider.error = new OwnerReportDeliveryError("LINE_API_ERROR", 500, true);
  const dependencies = {
    store,
    provider,
    now: () => new Date("2026-10-23T01:00:00Z"),
    logger: silentLogger,
  };

  await assert.rejects(
    runOwnerReportWithDependencies("DAILY", { send: true }, dependencies),
    OwnerReportDeliveryError,
  );
  assert.deepEqual(store.failedCodes, [{ code: "LINE_API_ERROR_500", retryable: true }]);

  provider.error = undefined;
  const retry = await runOwnerReportWithDependencies("DAILY", { send: true }, dependencies);
  assert.equal(retry.delivery, "SENT");
  assert.equal(provider.payloads.length, 2);
  assert.equal(provider.payloads[1], provider.payloads[0]);
  assert.equal(provider.retryKeys[1], provider.retryKeys[0]);
});

test("a LINE success followed by ledger failure retries the unchanged snapshot and key", async () => {
  const store = new MemoryReportStore();
  store.failMarkSent = true;
  const provider = new MemoryProvider();
  let now = new Date("2026-10-23T01:00:00Z");
  const dependencies = { store, provider, now: () => now, logger: silentLogger };

  await assert.rejects(
    runOwnerReportWithDependencies("DAILY", { send: true }, dependencies),
    /database unavailable/,
  );
  const originalPayload = provider.payloads[0];
  const originalKey = provider.retryKeys[0];

  store.failMarkSent = false;
  now = new Date("2026-10-23T01:16:00Z");
  const retry = await runOwnerReportWithDependencies("DAILY", { send: true }, dependencies);
  assert.equal(retry.delivery, "SENT");
  assert.equal(provider.payloads[1], originalPayload);
  assert.equal(provider.retryKeys[1], originalKey);
});

test("expired retry keys stop automatic delivery and require manual review", async () => {
  const store = new MemoryReportStore();
  const provider = new MemoryProvider();
  provider.error = new OwnerReportDeliveryError("NETWORK_ERROR", undefined, true);
  let now = new Date("2026-10-23T01:00:00Z");
  const dependencies = { store, provider, now: () => now, logger: silentLogger };
  await assert.rejects(
    runOwnerReportWithDependencies("DAILY", { send: true }, dependencies),
    OwnerReportDeliveryError,
  );

  provider.error = undefined;
  now = new Date("2026-10-24T01:00:00Z");
  const retry = await runOwnerReportWithDependencies("DAILY", { send: true }, dependencies);
  assert.equal(retry.delivery, "MANUAL_REVIEW");
  assert.equal(provider.payloads.length, 1);
});

test("authorization and invalid-request errors are not automatically retried", async () => {
  for (const status of [400, 401]) {
    const store = new MemoryReportStore();
    const provider = new MemoryProvider();
    provider.error = new OwnerReportDeliveryError("LINE_API_ERROR", status, false);
    const dependencies = {
      store,
      provider,
      now: () => new Date("2026-10-23T01:00:00Z"),
      logger: silentLogger,
    };
    await assert.rejects(
      runOwnerReportWithDependencies("DAILY", { send: true }, dependencies),
      OwnerReportDeliveryError,
    );
    provider.error = undefined;
    const retry = await runOwnerReportWithDependencies("DAILY", { send: true }, dependencies);
    assert.equal(retry.delivery, "MANUAL_REVIEW");
    assert.equal(provider.payloads.length, 1);
  }
});

test("DEMO service execution requires the environment gate even for preview", async () => {
  await assert.rejects(
    runOwnerReportWithDependencies(
      "DAILY",
      { send: false, dataMode: "DEMO_TEST", demoEnabled: false },
      { store: new MemoryReportStore(), provider: new MemoryProvider(), logger: silentLogger },
    ),
    /OWNER_REPORT_DEMO_ENABLED=true/,
  );
});

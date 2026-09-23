import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { handleConfirmedPaymentOnce } from "../src/payment-flow.mjs";

test("pending, failed, and expired payments never unlock", async () => {
  for (const paymentStatus of ["PENDING", "FAILED", "EXPIRED"]) {
    let unlockCount = 0;
    const handled = await handleConfirmedPaymentOnce(
      { transactionId: 1, slotNumber: 2, paymentStatus },
      new Set(),
      {
        onSaleConfirmed() {},
        async unlock() {
          unlockCount += 1;
        },
        onUnlocked() {},
        onUnlockFailed() {},
      },
    );
    assert.equal(handled, false);
    assert.equal(unlockCount, 0);
  }
});

test("success unlocks the correct slot exactly once and completes the Thank You path", async () => {
  const attempted = new Set();
  const unlockedSlots = [];
  let completed = 0;
  const dependencies = {
    onSaleConfirmed() {},
    async unlock(slotNumber) {
      unlockedSlots.push(slotNumber);
    },
    onUnlocked() {
      completed += 1;
    },
    onUnlockFailed() {},
  };
  const payment = {
    transactionId: 81,
    slotNumber: 3,
    paymentStatus: "SUCCESS",
  };

  assert.equal(
    await handleConfirmedPaymentOnce(payment, attempted, dependencies),
    true,
  );
  assert.equal(
    await handleConfirmedPaymentOnce(payment, attempted, dependencies),
    false,
  );
  assert.deepEqual(unlockedSlots, [3]);
  assert.equal(completed, 1);
});

test("unlock failure preserves confirmed-sale messaging and does not become payment failure", async () => {
  let confirmed = 0;
  let unlockFailed = 0;
  let unlocked = 0;
  await handleConfirmedPaymentOnce(
    { transactionId: 82, slotNumber: 1, paymentStatus: "SUCCESS" },
    new Set(),
    {
      onSaleConfirmed() {
        confirmed += 1;
      },
      async unlock() {
        throw new Error("Pi offline");
      },
      onUnlocked() {
        unlocked += 1;
      },
      onUnlockFailed() {
        unlockFailed += 1;
      },
    },
  );
  assert.equal(confirmed, 1);
  assert.equal(unlockFailed, 1);
  assert.equal(unlocked, 0);
});

test("customer UI uses provider QR, backend polling, waiting state, and no fake success path", async () => {
  const home = await readFile(
    new URL("../src/pages/HomePage.tsx", import.meta.url),
    "utf8",
  );
  const api = await readFile(
    new URL("../src/api/transaction.ts", import.meta.url),
    "utf8",
  );

  assert.match(home, /src=\{payment\.qrImageUrl\}/);
  assert.match(home, /Waiting for payment confirmation/);
  assert.match(home, /fetchPaymentStatus\(\s*transactionId/);
  assert.match(home, /handleConfirmedPaymentOnce/);
  assert.match(home, /Payment successful/);
  assert.match(home, /Unable to unlock the compartment/);
  assert.match(home, /<h1>Thank You<\/h1>/);
  assert.match(api, /\/payment-status/);
  assert.doesNotMatch(home, /mock-purchase|createMockPurchase|fake payment/i);
  assert.doesNotMatch(home, /setTimeout\([^)]*SUCCESS/i);
});

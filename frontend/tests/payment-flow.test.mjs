import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { handleConfirmedPaymentOnce } from "../src/payment-flow.mjs";
import {
  AUDIO_EVENTS,
  commitRestockAndNotify,
  validateEmployeeAndNotify,
} from "../src/audio-feedback.mjs";

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
  const audioEvents = [];
  let completed = 0;
  const dependencies = {
    onSaleConfirmed() {},
    playAudio(event) {
      audioEvents.push(event);
    },
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
  assert.deepEqual(audioEvents, [AUDIO_EVENTS.PAYMENT_SUCCESS]);
  assert.equal(completed, 1);
});

test("unlock failure preserves confirmed-sale messaging and does not become payment failure", async () => {
  let confirmed = 0;
  let unlockFailed = 0;
  let unlocked = 0;
  const audioEvents = [];
  await handleConfirmedPaymentOnce(
    { transactionId: 82, slotNumber: 1, paymentStatus: "SUCCESS" },
    new Set(),
    {
      onSaleConfirmed() {
        confirmed += 1;
      },
      playAudio(event) {
        audioEvents.push(event);
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
  assert.deepEqual(audioEvents, [
    AUDIO_EVENTS.PAYMENT_SUCCESS,
    AUDIO_EVENTS.UNLOCK_FAILED,
  ]);
});

test("audio failure never prevents a confirmed payment from attempting unlock", async () => {
  let unlockCount = 0;
  let completed = 0;

  await handleConfirmedPaymentOnce(
    { transactionId: 83, slotNumber: 2, paymentStatus: "SUCCESS" },
    new Set(),
    {
      onSaleConfirmed() {},
      playAudio() {
        throw new Error("Pi audio offline");
      },
      async unlock() {
        unlockCount += 1;
      },
      onUnlocked() {
        completed += 1;
      },
      onUnlockFailed() {},
    },
  );

  assert.equal(unlockCount, 1);
  assert.equal(completed, 1);
});

test("employee success audio occurs only after backend validation accepts the match", async () => {
  const audioEvents = [];
  const employee = { id: 7, employeeCode: "EMP007", name: "Nok" };

  const accepted = await validateEmployeeAndNotify("EMP007", undefined, {
    async validateEmployee() {
      return employee;
    },
    playAudio(event) {
      audioEvents.push(event);
      return Promise.reject(new Error("speaker offline"));
    },
  });

  assert.equal(accepted, employee);
  assert.deepEqual(audioEvents, [AUDIO_EVENTS.EMPLOYEE_AUTH_SUCCESS]);

  await assert.rejects(
    validateEmployeeAndNotify("EMP008", undefined, {
      async validateEmployee() {
        throw new Error("backend rejected employee");
      },
      playAudio(event) {
        audioEvents.push(event);
      },
    }),
  );
  assert.deepEqual(audioEvents, [AUDIO_EVENTS.EMPLOYEE_AUTH_SUCCESS]);
});

test("restock audio occurs after commit and audio failure preserves the result", async () => {
  const order = [];
  const restock = { restockId: 4, employeeId: 7, slots: [] };

  const result = await commitRestockAndNotify(7, {
    async commitRestock(employeeId) {
      order.push(`commit:${employeeId}`);
      return restock;
    },
    playAudio(event) {
      order.push(`audio:${event}`);
      return Promise.reject(new Error("speaker offline"));
    },
  });

  assert.equal(result, restock);
  assert.deepEqual(order, ["commit:7", `audio:${AUDIO_EVENTS.RESTOCK_COMPLETE}`]);
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
  const audioApi = await readFile(
    new URL("../src/api/audio.ts", import.meta.url),
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
  assert.match(audioApi, /PI_UNLOCK_BASE_URL/);
  assert.match(audioApi, /\/audio\/play/);
  assert.doesNotMatch(home, /mock-purchase|createMockPurchase|fake payment/i);
  assert.doesNotMatch(home, /setTimeout\([^)]*SUCCESS/i);
});

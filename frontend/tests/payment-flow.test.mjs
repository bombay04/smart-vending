import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import {
  handleConfirmedPaymentOnce,
  resumeWaitingPaymentAfterCancellationReconciliation,
} from "../src/payment-flow.mjs";
import {
  AUDIO_EVENTS,
  commitRestockAndNotify,
  validateEmployeeAndNotify,
} from "../src/audio-feedback.mjs";

test("pending, failed, and expired payments never unlock", async () => {
  for (const paymentStatus of ["PENDING", "FAILED", "EXPIRED"]) {
    let unlockCount = 0;
    const audioEvents = [];
    const handled = await handleConfirmedPaymentOnce(
      { transactionId: 1, slotNumber: 2, paymentStatus },
      new Set(),
      {
        onSaleConfirmed() {},
        playAudio(event) {
          audioEvents.push(event);
        },
        async unlock() {
          unlockCount += 1;
        },
        onUnlocked() {},
        onUnlockFailed() {},
      },
    );
    assert.equal(handled, false);
    assert.equal(unlockCount, 0);
    assert.deepEqual(audioEvents, []);
  }
});

test("customer-cancelled provider success never unlocks", async () => {
  let unlockCount = 0;
  let confirmedCount = 0;
  const audioEvents = [];
  const handled = await handleConfirmedPaymentOnce(
    {
      transactionId: 2,
      slotNumber: 1,
      paymentStatus: "SUCCESS",
      customerCancelled: true,
    },
    new Set(),
    {
      onSaleConfirmed() {
        confirmedCount += 1;
      },
      playAudio(event) {
        audioEvents.push(event);
      },
      async unlock() {
        unlockCount += 1;
      },
      onUnlocked() {},
      onUnlockFailed() {},
    },
  );

  assert.equal(handled, false);
  assert.equal(unlockCount, 0);
  assert.equal(confirmedCount, 0);
  assert.deepEqual(audioEvents, []);
});

test("non-terminal cancellation conflict reconciliation resumes waiting and polling", () => {
  const stalePayment = {
    transactionId: 91,
    slotNumber: 1,
    paymentStatus: "PENDING",
  };
  const authoritativePayment = {
    ...stalePayment,
    qrImageUrl: "https://api.omise.co/qr/current",
  };
  const currentScreen = {
    phase: "waiting",
    payment: stalePayment,
    isCancelling: true,
    cancelError: "stale cancellation error",
    pollError: "stale polling error",
  };

  assert.deepEqual(
    resumeWaitingPaymentAfterCancellationReconciliation(
      currentScreen,
      91,
      authoritativePayment,
    ),
    {
      phase: "waiting",
      payment: authoritativePayment,
      isCancelling: false,
      cancelError: null,
      pollError: null,
    },
  );
});

test("success unlocks the correct slot exactly once and completes the customer success path", async () => {
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

test("unlock HTTP failure emits both events once and preserves the failure outcome", async () => {
  const attempted = new Set();
  let confirmed = 0;
  let unlockFailed = 0;
  let unlocked = 0;
  const audioEvents = [];
  const payment = {
    transactionId: 82,
    slotNumber: 1,
    paymentStatus: "SUCCESS",
  };
  const dependencies = {
    onSaleConfirmed() {
      confirmed += 1;
    },
    playAudio(event) {
      audioEvents.push(event);
    },
    async unlock() {
      throw new Error("Hardware status unavailable (HTTP 503)");
    },
    onUnlocked() {
      unlocked += 1;
    },
    onUnlockFailed() {
      unlockFailed += 1;
    },
  };

  assert.equal(
    await handleConfirmedPaymentOnce(payment, attempted, dependencies),
    true,
  );
  assert.equal(
    await handleConfirmedPaymentOnce(payment, attempted, dependencies),
    false,
  );

  assert.equal(confirmed, 1);
  assert.equal(unlockFailed, 1);
  assert.equal(unlocked, 0);
  assert.deepEqual(audioEvents, [
    AUDIO_EVENTS.PAYMENT_SUCCESS,
    AUDIO_EVENTS.UNLOCK_FAILED,
  ]);
});

test("unlock network rejection emits UNLOCK_FAILED through the same UI failure path", async () => {
  let unlockFailed = 0;
  const audioEvents = [];

  await handleConfirmedPaymentOnce(
    { transactionId: 84, slotNumber: 1, paymentStatus: "SUCCESS" },
    new Set(),
    {
      onSaleConfirmed() {},
      playAudio(event) {
        audioEvents.push(event);
      },
      async unlock() {
        throw new TypeError("fetch failed");
      },
      onUnlocked() {
        assert.fail("network rejection must not use the successful-unlock path");
      },
      onUnlockFailed() {
        unlockFailed += 1;
      },
    },
  );

  assert.equal(unlockFailed, 1);
  assert.deepEqual(audioEvents, [
    AUDIO_EVENTS.PAYMENT_SUCCESS,
    AUDIO_EVENTS.UNLOCK_FAILED,
  ]);
});

test("UNLOCK_FAILED waits for PAYMENT_SUCCESS audio without delaying failure UI", async () => {
  const audioEvents = [];
  let unlockFailed = 0;
  let finishPaymentAudio;
  const paymentAudio = new Promise((resolve) => {
    finishPaymentAudio = resolve;
  });

  await handleConfirmedPaymentOnce(
    { transactionId: 85, slotNumber: 1, paymentStatus: "SUCCESS" },
    new Set(),
    {
      onSaleConfirmed() {},
      playAudio(event) {
        audioEvents.push(event);
        return event === AUDIO_EVENTS.PAYMENT_SUCCESS
          ? paymentAudio
          : Promise.resolve();
      },
      async unlock() {
        throw new Error("Pi hardware unavailable");
      },
      onUnlocked() {},
      onUnlockFailed() {
        unlockFailed += 1;
      },
    },
  );

  assert.equal(unlockFailed, 1);
  assert.deepEqual(audioEvents, [AUDIO_EVENTS.PAYMENT_SUCCESS]);

  finishPaymentAudio();
  await paymentAudio;
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(audioEvents, [
    AUDIO_EVENTS.PAYMENT_SUCCESS,
    AUDIO_EVENTS.UNLOCK_FAILED,
  ]);
});

test("UNLOCK_FAILED audio rejection does not change the existing failure outcome", async () => {
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
        if (event === AUDIO_EVENTS.UNLOCK_FAILED) {
          return Promise.reject(new Error("speaker unavailable"));
        }
      },
      async unlock() {
        throw new Error("Pi hardware unavailable");
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

test("UNLOCK_FAILED is mapped to the existing Pi unlock_failed.wav asset", async () => {
  const piService = await readFile(
    new URL("../../edge/pi_unlock_service.py", import.meta.url),
    "utf8",
  );

  assert.equal(AUDIO_EVENTS.UNLOCK_FAILED, "UNLOCK_FAILED");
  assert.match(piService, /"UNLOCK_FAILED": "unlock_failed\.wav"/);
  await access(
    new URL("../../edge/audio/assets/unlock_failed.wav", import.meta.url),
  );
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
  assert.match(home, /กำลังรอยืนยันการชำระเงิน/);
  assert.match(home, /fetchPaymentStatus\(\s*transactionId/);
  assert.match(home, /handleConfirmedPaymentOnce/);
  assert.match(home, /ชำระเงินสำเร็จ/);
  assert.match(home, /ไม่สามารถปลดล็อกช่องสินค้าได้/);
  assert.match(home, /<h1>ขอบคุณค่ะ<\/h1>/);
  assert.match(api, /\/payment-status/);
  assert.match(audioApi, /PI_UNLOCK_BASE_URL/);
  assert.match(audioApi, /\/audio\/play/);
  assert.doesNotMatch(home, /mock-purchase|createMockPurchase|fake payment/i);
  assert.doesNotMatch(home, /setTimeout\([^)]*SUCCESS/i);
});

test("QR cancellation is backend-authoritative, guarded, retryable, and race-safe", async () => {
  const [home, api, flow, css] = await Promise.all([
    readFile(new URL("../src/pages/HomePage.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/api/transaction.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/payment-flow.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/App.css", import.meta.url), "utf8"),
  ]);

  assert.match(home, /"ยกเลิก"/);
  assert.match(home, /cancelPayment\(transactionId\)/);
  assert.match(home, /disabled=\{paymentScreen\.isCancelling\}/);
  assert.match(home, /cancellationInFlightTransactionIds/);
  assert.match(home, /ไม่สามารถยกเลิกรายการได้ กรุณาลองอีกครั้ง/);
  assert.match(home, /PAYMENT_ALREADY_CONFIRMED/);
  assert.match(home, /fetchPaymentStatus\(transactionId\)/);
  assert.match(
    home,
    /resumeWaitingPaymentAfterCancellationReconciliation\([\s\S]*?currentPayment/,
  );
  assert.match(home, /customerCancelledTransactionIds\.current\.has\(transactionId\)/);
  assert.match(home, /controller\?\.abort\(\)/);
  assert.match(api, /\$\{transactionId\}\/cancel/);
  assert.match(api, /method: "POST"/);
  assert.match(flow, /payment\.customerCancelled === true/);
  assert.match(css, /\.payment-cancel-button \{[\s\S]*?color: #ffffff;[\s\S]*?background: #2563eb;/);
  assert.match(css, /\.payment-cancel-button:disabled \{[\s\S]*?background: #93c5fd;/);
});

test("payment failures and unlock failure use their distinct auto-return delays", async () => {
  const home = await readFile(
    new URL("../src/pages/HomePage.tsx", import.meta.url),
    "utf8",
  );

  assert.match(home, /PAYMENT_FAILURE_RETURN_MS = 2000/);
  assert.match(home, /UNLOCK_FAILURE_RETURN_MS = 5000/);
  assert.match(
    home,
    /paymentScreen\?\.phase !== "failed"[\s\S]*?setPaymentScreen\(null\)[\s\S]*?PAYMENT_FAILURE_RETURN_MS/,
  );
  assert.match(home, /ชำระเงินไม่สำเร็จ/);
  assert.match(home, /กรุณาลองใหม่อีกครั้ง/);
  assert.match(home, /หมดเวลาชำระเงิน/);
  assert.match(home, /กรุณาเลือกสินค้าและทำรายการใหม่/);
  assert.doesNotMatch(home, /กลับไปเลือกสินค้า/);
  assert.match(home, /paymentScreen\.phase === "unlock-failed"/);
  assert.match(
    home,
    /paymentScreen\?\.phase !== "unlock-failed"[\s\S]*?setPaymentScreen\(null\)[\s\S]*?UNLOCK_FAILURE_RETURN_MS/,
  );
  const unlockFailureEffect = home.match(
    /if \(paymentScreen\?\.phase !== "unlock-failed"\)[\s\S]*?\}, \[paymentScreen\]\);/,
  )?.[0];
  assert.ok(unlockFailureEffect);
  assert.doesNotMatch(unlockFailureEffect, /PAYMENT_FAILURE_RETURN_MS/);
});

test("unlock failure shows only the staff-assistance warning with no manual navigation", async () => {
  const home = await readFile(
    new URL("../src/pages/HomePage.tsx", import.meta.url),
    "utf8",
  );
  const unlockFailureStart = home.indexOf(
    '{paymentScreen.phase === "unlock-failed"',
  );
  const unlockFailureEnd = home.indexOf("\n          )}", unlockFailureStart);
  const unlockFailureUi = home.slice(unlockFailureStart, unlockFailureEnd);

  assert.ok(unlockFailureStart >= 0 && unlockFailureEnd > unlockFailureStart);
  assert.match(unlockFailureUi, /<h1>ชำระเงินสำเร็จ<\/h1>/);
  assert.match(unlockFailureUi, /ไม่สามารถปลดล็อกช่องสินค้าได้\s*<br \/>\s*กรุณาติดต่อพนักงาน/);
  assert.doesNotMatch(unlockFailureUi, /การซื้อเสร็จสมบูรณ์แล้ว/);
  assert.doesNotMatch(unlockFailureUi, /ไม่มีสินค้า/);
  assert.doesNotMatch(unlockFailureUi, /กลับหน้าหลัก/);
  assert.doesNotMatch(unlockFailureUi, /<button/);
});

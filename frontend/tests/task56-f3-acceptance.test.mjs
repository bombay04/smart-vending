import assert from "node:assert/strict";
import test from "node:test";
import {
  FULFILLMENT_STATES,
  getPaymentRecoveryAction,
  persistActivePayment,
  readActivePayment,
  recoverSuccessfulPaymentOnce,
} from "../src/active-payment-recovery.mjs";

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

const success = {
  transactionId: 5630,
  slotNumber: 2,
  paymentStatus: "SUCCESS",
  customerCancelled: false,
};

test("F.3: interruption before ATTEMPTING persistence permits one recovery attempt", async () => {
  const persisted = storage();
  assert.equal(
    persistActivePayment(5630, FULFILLMENT_STATES.NOT_STARTED, persisted),
    true,
  );
  assert.equal(
    getPaymentRecoveryAction(success, readActivePayment(persisted).fulfillmentState),
    "ATTEMPT_UNLOCK",
  );
  let attempts = 0;
  await recoverSuccessfulPaymentOnce(
    success,
    readActivePayment(persisted),
    new Set(),
    {
      attemptUnlock() {
        attempts += 1;
      },
      showAssistance() {},
      showSuccess() {},
      showUnlockFailed() {},
    },
  );
  assert.equal(attempts, 1);
});

test("F.3: persisted ATTEMPTING gives assistance with no automatic resend", async () => {
  // Covers interruption immediately after persistence and after Serial write
  // but before the browser receives an HTTP response.
  for (const point of ["before Serial write", "after Serial write"]) {
    const persisted = storage();
    assert.equal(
      persistActivePayment(5630, FULFILLMENT_STATES.ATTEMPTING, persisted),
      true,
    );
    let attempts = 0;
    let assistance = 0;
    const active = readActivePayment(persisted);
    assert.equal(
      getPaymentRecoveryAction(success, active.fulfillmentState),
      "SHOW_ASSISTANCE",
      point,
    );
    await recoverSuccessfulPaymentOnce(success, active, new Set(), {
      attemptUnlock() {
        attempts += 1;
      },
      showAssistance() {
        assistance += 1;
      },
      showSuccess() {},
      showUnlockFailed() {},
    });
    assert.equal(attempts, 0, point);
    assert.equal(assistance, 1, point);
  }
});

test("F.3: persisted UNLOCKED restores success without sending another unlock", async () => {
  const persisted = storage();
  persistActivePayment(5630, FULFILLMENT_STATES.UNLOCKED, persisted);
  let attempts = 0;
  let successViews = 0;
  const active = readActivePayment(persisted);
  assert.equal(
    getPaymentRecoveryAction(success, active.fulfillmentState),
    "SHOW_SUCCESS",
  );
  await recoverSuccessfulPaymentOnce(success, active, new Set(), {
    attemptUnlock() {
      attempts += 1;
    },
    showAssistance() {},
    showSuccess() {
      successViews += 1;
    },
    showUnlockFailed() {},
  });
  assert.equal(attempts, 0);
  assert.equal(successViews, 1);
});

test("F.3: non-success backend payment states never choose recovery unlock", () => {
  for (const [paymentStatus, customerCancelled, expected] of [
    ["PENDING", false, "RESTORE_WAITING"],
    ["FAILED", false, "SHOW_FAILURE"],
    ["EXPIRED", false, "SHOW_FAILURE"],
    ["SUCCESS", true, "CLEAR_CANCELLED"],
  ]) {
    assert.equal(
      getPaymentRecoveryAction(
        { ...success, paymentStatus, customerCancelled },
        FULFILLMENT_STATES.NOT_STARTED,
      ),
      expected,
    );
  }
});

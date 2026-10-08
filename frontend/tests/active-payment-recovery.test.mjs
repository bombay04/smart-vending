import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ACTIVE_PAYMENT_STORAGE_KEY,
  FULFILLMENT_STATES,
  clearActivePayment,
  getPaymentRecoveryAction,
  installKioskRefreshGuard,
  isKioskRefreshShortcut,
  persistActivePayment,
  readActivePayment,
} from "../src/active-payment-recovery.mjs";
import {
  handleConfirmedPaymentOnce,
  reconcileUnpersistedPayment,
} from "../src/payment-flow.mjs";

function createStorage(initialEntries = {}) {
  const entries = new Map(Object.entries(initialEntries));
  return {
    getItem(key) {
      return entries.get(key) ?? null;
    },
    setItem(key, value) {
      entries.set(key, value);
    },
    removeItem(key) {
      entries.delete(key);
    },
    entries,
  };
}

test("kiosk refresh guard recognizes only browser refresh shortcuts", () => {
  const event = (key, modifiers = {}) => ({
    key,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...modifiers,
  });

  assert.equal(isKioskRefreshShortcut(event("F5")), true);
  assert.equal(isKioskRefreshShortcut(event("F5", { ctrlKey: true })), true);
  assert.equal(isKioskRefreshShortcut(event("r", { ctrlKey: true })), true);
  assert.equal(
    isKioskRefreshShortcut(event("R", { ctrlKey: true, shiftKey: true })),
    true,
  );
  assert.equal(isKioskRefreshShortcut(event("r", { metaKey: true })), true);
  assert.equal(isKioskRefreshShortcut(event("r")), false);
  assert.equal(isKioskRefreshShortcut(event("x", { ctrlKey: true })), false);
});

test("installed kiosk guard blocks refresh at window capture without inferring cancellation", () => {
  const calls = [];
  const target = {
    addEventListener(type, listener, capture) {
      calls.push(["add", type, listener, capture]);
      this.listener = listener;
    },
    removeEventListener(type, listener, capture) {
      calls.push(["remove", type, listener, capture]);
    },
  };
  const cleanup = installKioskRefreshGuard(target);
  let prevented = 0;
  let stopped = 0;
  const dispatch = (key, modifiers = {}) =>
    target.listener({
      key,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      ...modifiers,
      preventDefault() {
        prevented += 1;
      },
      stopPropagation() {
        stopped += 1;
      },
    });

  dispatch("F5");
  dispatch("F5", { ctrlKey: true });
  dispatch("r", { ctrlKey: true });
  dispatch("R", { ctrlKey: true, shiftKey: true });
  dispatch("r", { metaKey: true });
  dispatch("r");
  dispatch("x", { ctrlKey: true });
  cleanup();

  assert.equal(prevented, 5);
  assert.equal(stopped, 5);
  assert.equal(calls[0][0], "add");
  assert.equal(calls[0][1], "keydown");
  assert.equal(calls[0][3], true);
  assert.deepEqual(calls[1], ["remove", "keydown", calls[0][2], true]);
});

test("active payment uses a minimal versioned schema and can be read back", () => {
  const storage = createStorage();

  assert.equal(persistActivePayment(81, undefined, storage), true);
  assert.deepEqual(readActivePayment(storage), {
    version: 1,
    transactionId: 81,
    fulfillmentState: FULFILLMENT_STATES.NOT_STARTED,
  });
  assert.deepEqual(
    Object.keys(JSON.parse(storage.getItem(ACTIVE_PAYMENT_STORAGE_KEY))).sort(),
    ["fulfillmentState", "transactionId", "version"],
  );
});

test("active payment persistence verifies the stored value", () => {
  const storage = createStorage({ unrelated: "keep-me" });
  storage.setItem = () => undefined;

  assert.equal(
    persistActivePayment(81, FULFILLMENT_STATES.NOT_STARTED, storage),
    false,
  );
  assert.equal(storage.getItem(ACTIVE_PAYMENT_STORAGE_KEY), null);
  assert.equal(storage.getItem("unrelated"), "keep-me");
});

test("malformed JSON, invalid transaction IDs, and unknown states are rejected", () => {
  for (const serialized of [
    "{not-json",
    JSON.stringify({
      version: 1,
      transactionId: 0,
      fulfillmentState: "NOT_STARTED",
    }),
    JSON.stringify({
      version: 1,
      transactionId: 81,
      fulfillmentState: "RETRY_UNLOCK",
    }),
    JSON.stringify({
      version: 2,
      transactionId: 81,
      fulfillmentState: "NOT_STARTED",
    }),
  ]) {
    const storage = createStorage({
      [ACTIVE_PAYMENT_STORAGE_KEY]: serialized,
      unrelated: "keep-me",
    });

    assert.equal(readActivePayment(storage), null);
    assert.equal(storage.getItem(ACTIVE_PAYMENT_STORAGE_KEY), null);
    assert.equal(storage.getItem("unrelated"), "keep-me");
  }
});

test("clearing an active payment removes only the scoped matching entry", () => {
  const storage = createStorage({ unrelated: "keep-me" });
  persistActivePayment(81, FULFILLMENT_STATES.ATTEMPTING, storage);

  assert.equal(clearActivePayment(82, storage), false);
  assert.notEqual(storage.getItem(ACTIVE_PAYMENT_STORAGE_KEY), null);
  assert.equal(clearActivePayment(81, storage), true);
  assert.equal(storage.getItem(ACTIVE_PAYMENT_STORAGE_KEY), null);
  assert.equal(storage.getItem("unrelated"), "keep-me");
});

test("authoritative pending, cancelled, failed, and expired recovery actions never unlock", () => {
  for (const [payment, expected] of [
    [{ paymentStatus: "PENDING", customerCancelled: false }, "RESTORE_WAITING"],
    [{ paymentStatus: "SUCCESS", customerCancelled: true }, "CLEAR_CANCELLED"],
    [{ paymentStatus: "FAILED", customerCancelled: false }, "SHOW_FAILURE"],
    [{ paymentStatus: "EXPIRED", customerCancelled: false }, "SHOW_FAILURE"],
  ]) {
    assert.equal(
      getPaymentRecoveryAction(payment, FULFILLMENT_STATES.NOT_STARTED),
      expected,
    );
  }
});

test("successful recovery maps every persisted fulfillment state safely", () => {
  const success = { paymentStatus: "SUCCESS", customerCancelled: false };

  assert.equal(
    getPaymentRecoveryAction(success, FULFILLMENT_STATES.NOT_STARTED),
    "ATTEMPT_UNLOCK",
  );
  assert.equal(
    getPaymentRecoveryAction(success, FULFILLMENT_STATES.ATTEMPTING),
    "SHOW_ASSISTANCE",
  );
  assert.equal(
    getPaymentRecoveryAction(success, FULFILLMENT_STATES.UNLOCKED),
    "SHOW_SUCCESS",
  );
  assert.equal(
    getPaymentRecoveryAction(success, FULFILLMENT_STATES.UNLOCK_FAILED),
    "SHOW_UNLOCK_FAILED",
  );
});

test("created payment persistence failure uses cancellation and authoritative reconciliation", async () => {
  let fetchCount = 0;
  const payment = {
    transactionId: 81,
    slotNumber: 2,
    paymentStatus: "PENDING",
    customerCancelled: false,
  };

  const cancelled = await reconcileUnpersistedPayment(payment, {
    async cancel(transactionId) {
      assert.equal(transactionId, 81);
      return { ...payment, customerCancelled: true };
    },
    async fetchStatus() {
      fetchCount += 1;
      return payment;
    },
  });
  assert.equal(cancelled.action, "CANCELLED");
  assert.equal(fetchCount, 0);

  const blocked = await reconcileUnpersistedPayment(payment, {
    async cancel() {
      throw new TypeError("network unavailable");
    },
    async fetchStatus(transactionId) {
      assert.equal(transactionId, 81);
      return payment;
    },
  });
  assert.deepEqual(blocked, { action: "BLOCKED", payment });
});

test("fulfillment persistence brackets one successful physical unlock", async () => {
  const order = [];
  const payment = {
    transactionId: 81,
    slotNumber: 2,
    paymentStatus: "SUCCESS",
    customerCancelled: false,
  };

  await handleConfirmedPaymentOnce(payment, new Set(), {
    onSaleConfirmed() {
      order.push("confirmed");
    },
    beforeUnlockAttempt() {
      order.push("persist:ATTEMPTING");
    },
    async unlock() {
      order.push("unlock");
    },
    onUnlockSucceeded() {
      order.push("persist:UNLOCKED");
    },
    onUnlocked() {
      order.push("success-ui");
    },
    onUnlockFailed() {
      assert.fail("successful unlock must not use the failure UI");
    },
    playAudio() {
      order.push("success-audio");
    },
  });

  assert.deepEqual(order, [
    "confirmed",
    "persist:ATTEMPTING",
    "unlock",
    "persist:UNLOCKED",
    "success-audio",
    "success-ui",
  ]);
});

test("failed ATTEMPTING persistence suppresses unlock and all outcome audio", async () => {
  let unlockCount = 0;
  let assistanceCount = 0;
  const audioEvents = [];

  const handled = await handleConfirmedPaymentOnce(
    {
      transactionId: 83,
      slotNumber: 2,
      paymentStatus: "SUCCESS",
      customerCancelled: false,
    },
    new Set(),
    {
      onSaleConfirmed() {},
      beforeUnlockAttempt() {
        return false;
      },
      onUnlockSuppressed() {
        assistanceCount += 1;
      },
      async unlock() {
        unlockCount += 1;
      },
      onUnlocked() {},
      onUnlockFailed() {},
      playAudio(event) {
        audioEvents.push(event);
      },
    },
  );

  assert.equal(handled, true);
  assert.equal(unlockCount, 0);
  assert.equal(assistanceCount, 1);
  assert.deepEqual(audioEvents, []);
});

test("failed physical unlock persists UNLOCK_FAILED before failure audio and UI", async () => {
  const order = [];

  await handleConfirmedPaymentOnce(
    {
      transactionId: 82,
      slotNumber: 1,
      paymentStatus: "SUCCESS",
      customerCancelled: false,
    },
    new Set(),
    {
      onSaleConfirmed() {},
      beforeUnlockAttempt() {
        order.push("persist:ATTEMPTING");
      },
      async unlock() {
        order.push("unlock");
        throw new Error("relay unavailable");
      },
      onUnlockRejected() {
        order.push("persist:UNLOCK_FAILED");
      },
      onUnlocked() {
        assert.fail("failed unlock must not use the success UI");
      },
      onUnlockFailed() {
        order.push("failure-ui");
      },
      playAudio() {
        order.push("failure-audio");
      },
    },
  );

  assert.deepEqual(order, [
    "persist:ATTEMPTING",
    "unlock",
    "persist:UNLOCK_FAILED",
    "failure-audio",
    "failure-ui",
  ]);
});

test("HomePage persists creation before waiting and recovers only from backend authority", async () => {
  const home = await readFile(
    new URL("../src/pages/HomePage.tsx", import.meta.url),
    "utf8",
  );
  const creation = home.slice(
    home.indexOf("async function handleBuy"),
    home.indexOf("const handleCancelPayment"),
  );
  const recovery = home.slice(
    home.indexOf("const recover = async"),
    home.indexOf("void recover();"),
  );

  assert.ok(
    creation.indexOf("createPromptPayPayment") <
      creation.indexOf("persistActivePayment"),
  );
  assert.ok(
    creation.indexOf("persistActivePayment") <
      creation.indexOf('phase: "waiting"'),
  );
  assert.match(
    creation,
    /if \(!persistenceSucceeded\)[\s\S]*?reconcileUnpersistedPayment[\s\S]*?return;/,
  );
  assert.match(recovery, /fetchPaymentStatus\(\s*startupActivePayment\.transactionId/);
  assert.doesNotMatch(recovery, /createPromptPayPayment/);
  assert.match(recovery, /phase: "waiting"/);
  assert.match(recovery, /phase: "assistance"/);
  assert.match(recovery, /recoveryError\.status === 404/);
  assert.match(recovery, /setRecoveryState\("error"\)/);
  assert.doesNotMatch(
    recovery.slice(recovery.indexOf("setRecoveryState(\"error\")")),
    /clearActivePayment/,
  );
  assert.match(home, /return installKioskRefreshGuard\(window\)/);
});

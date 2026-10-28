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

class FakeSerial {
  constructor() {
    this.commands = [];
  }

  openSlot(slotNumber) {
    this.commands.push(`OPEN:${slotNumber}`);
  }
}

function createFakePiService(fakeSerial, requestCounter) {
  // Deliberately process-local: constructing a new instance simulates a
  // service restart and loses the in-memory transaction outcome cache.
  const transactionOutcomes = new Map();

  return {
    async unlock(slotNumber, transactionId, { loseResponse = false } = {}) {
      requestCounter.count += 1;

      const existing = transactionOutcomes.get(transactionId);
      if (existing) {
        return {
          data: {
            transactionId,
            slotNumber,
            status: existing,
            deduplicated: true,
          },
        };
      }

      transactionOutcomes.set(transactionId, "ATTEMPTING");
      fakeSerial.openSlot(slotNumber);
      transactionOutcomes.set(transactionId, "UNLOCK_COMMAND_SENT");

      if (loseResponse) {
        throw new Error("simulated lost unlock HTTP response");
      }

      return {
        data: {
          transactionId,
          slotNumber,
          status: "UNLOCK_COMMAND_SENT",
          deduplicated: false,
        },
      };
    },
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

test("T62-U03 waiver: lost response plus Pi-service restart and kiosk reload does not redispatch", async () => {
  const persisted = storage();
  const fakeSerial = new FakeSerial();
  const requestCounter = { count: 0 };
  let piService = createFakePiService(fakeSerial, requestCounter);

  // The kiosk persists ATTEMPTING before calling the Pi unlock endpoint.
  assert.equal(
    persistActivePayment(5630, FULFILLMENT_STATES.ATTEMPTING, persisted),
    true,
  );

  await assert.rejects(
    piService.unlock(2, 5630, { loseResponse: true }),
    /simulated lost unlock HTTP response/,
  );
  assert.deepEqual(fakeSerial.commands, ["OPEN:2"]);
  assert.equal(requestCounter.count, 1);

  // A new service instance has no process-local deduplication history.
  piService = createFakePiService(fakeSerial, requestCounter);

  // Reload the kiosk with the same browser storage. ATTEMPTING must route to
  // staff assistance and must not call the restarted service.
  const reloaded = readActivePayment(persisted);
  assert.equal(reloaded.fulfillmentState, FULFILLMENT_STATES.ATTEMPTING);
  assert.equal(
    getPaymentRecoveryAction(success, reloaded.fulfillmentState),
    "SHOW_ASSISTANCE",
  );

  let assistanceViews = 0;
  await recoverSuccessfulPaymentOnce(success, reloaded, new Set(), {
    attemptUnlock() {
      return piService.unlock(2, 5630);
    },
    showAssistance() {
      assistanceViews += 1;
    },
    showSuccess() {},
    showUnlockFailed() {},
  });

  assert.equal(assistanceViews, 1);
  assert.equal(requestCounter.count, 1, "kiosk recovery sent no second HTTP request");
  assert.deepEqual(
    fakeSerial.commands,
    ["OPEN:2"],
    "kiosk recovery emitted no second fake Serial OPEN",
  );
});

test("T62-U03 known limitation: explicit retry after Pi-service restart can redispatch", async () => {
  const fakeSerial = new FakeSerial();
  const requestCounter = { count: 0 };

  const firstPiService = createFakePiService(fakeSerial, requestCounter);
  const first = await firstPiService.unlock(2, 5630);
  assert.equal(first.data.deduplicated, false);

  const restartedPiService = createFakePiService(fakeSerial, requestCounter);
  const repeated = await restartedPiService.unlock(2, 5630);
  assert.equal(repeated.data.deduplicated, false);

  assert.equal(requestCounter.count, 2);
  assert.deepEqual(fakeSerial.commands, ["OPEN:2", "OPEN:2"]);
});

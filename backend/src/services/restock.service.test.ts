import assert from "node:assert/strict";
import test from "node:test";
import type {
  NotificationProvider,
  ProductStatusNotificationSlot,
  RestockNotification,
  SaleNotification,
} from "../notifications/notification-provider";
import { HttpError } from "../utils/http-error";
import {
  createMockRestockWithDependencies,
  type RestockResult,
  type RestockStore,
} from "./restock.service";

const committedRestock: RestockResult = {
  restockId: 44,
  employeeId: 7,
  employee: { employeeCode: "EMP007", name: "Verified Employee" },
  slots: [
    { slotNumber: 1, productName: "Tissue", status: "AVAILABLE" },
    { slotNumber: 2, productName: "Wet Wipes", status: "AVAILABLE" },
    { slotNumber: 3, productName: "Sanitary Pads", status: "AVAILABLE" },
  ],
};

class MemoryRestockStore implements RestockStore {
  notificationClaimed = false;
  commitCount = 0;
  listNotificationSlotsCount = 0;
  committed = structuredClone(committedRestock);
  databaseSlots: ProductStatusNotificationSlot[] = structuredClone(committedRestock.slots);

  constructor(private readonly failure: Error | null = null) {}

  async commitRestock(sessionId: number) {
    this.commitCount += 1;
    assert.equal(sessionId, 9);
    if (this.failure) throw this.failure;
    return structuredClone(this.committed);
  }

  async claimRestockNotification(restockId: number) {
    assert.equal(restockId, committedRestock.restockId);
    if (this.notificationClaimed) return false;
    this.notificationClaimed = true;
    return true;
  }

  async listRestockNotificationSlots() {
    this.listNotificationSlotsCount += 1;
    assert.ok(this.commitCount > 0);
    return structuredClone(this.databaseSlots).sort(
      (left, right) => left.slotNumber - right.slotNumber,
    );
  }
}

class MockNotificationProvider implements NotificationProvider {
  restockNotifications: RestockNotification[] = [];

  constructor(private readonly failure: Error | null = null) {}

  async sendSaleNotification(notification: SaleNotification) {
    void notification;
  }

  async sendRestockNotification(notification: RestockNotification) {
    this.restockNotifications.push(notification);
    if (this.failure) throw this.failure;
  }
}

test("successful restock sends one notification with three authoritative mappings", async () => {
  const store = new MemoryRestockStore();
  const provider = new MockNotificationProvider();

  const result = await createMockRestockWithDependencies(9, store, { provider });

  assert.deepEqual(result, committedRestock);
  assert.deepEqual(provider.restockNotifications, [
    { employee: committedRestock.employee, slots: store.databaseSlots },
  ]);
  assert.equal(store.notificationClaimed, true);
});

test("restock notification reads every configured slot after a partial restock result", async () => {
  const store = new MemoryRestockStore();
  store.committed.slots = [{ slotNumber: 1, productName: "Tissue", status: "AVAILABLE" }];
  store.databaseSlots = [
    { slotNumber: 3, productName: "Sanitary Pads", status: "AVAILABLE" },
    { slotNumber: 1, productName: "Tissue", status: "AVAILABLE" },
    { slotNumber: 2, productName: "Wet Wipes", status: "SOLD_OUT" },
  ];
  const provider = new MockNotificationProvider();

  const result = await createMockRestockWithDependencies(9, store, { provider });

  assert.deepEqual(result.slots, [{ slotNumber: 1, productName: "Tissue", status: "AVAILABLE" }]);
  assert.deepEqual(provider.restockNotifications, [
    {
      employee: committedRestock.employee,
      slots: [
        { slotNumber: 1, productName: "Tissue", status: "AVAILABLE" },
        { slotNumber: 2, productName: "Wet Wipes", status: "SOLD_OUT" },
        { slotNumber: 3, productName: "Sanitary Pads", status: "AVAILABLE" },
      ],
    },
  ]);
  assert.equal(store.listNotificationSlotsCount, 1);
});

test("failed restock never claims or sends a notification", async () => {
  const store = new MemoryRestockStore(new HttpError("Employee is inactive.", 403));
  const provider = new MockNotificationProvider();

  await assert.rejects(
    createMockRestockWithDependencies(9, store, { provider }),
    (error: unknown) => error instanceof HttpError && error.statusCode === 403,
  );
  assert.equal(store.notificationClaimed, false);
  assert.equal(store.listNotificationSlotsCount, 0);
  assert.equal(provider.restockNotifications.length, 0);
});

test("durable restock claim prevents duplicate notification handling", async () => {
  const store = new MemoryRestockStore();
  const provider = new MockNotificationProvider();
  const notifications = { provider };

  await createMockRestockWithDependencies(9, store, notifications);
  await createMockRestockWithDependencies(9, store, notifications);

  assert.equal(store.commitCount, 2);
  assert.equal(provider.restockNotifications.length, 1);
});

test("notification failure leaves the restock committed and slots available", async () => {
  const store = new MemoryRestockStore();
  const provider = new MockNotificationProvider(new Error("line-secret-value"));
  const logEntries: unknown[][] = [];

  const result = await createMockRestockWithDependencies(9, store, {
    provider,
    logger: { error: (...entry: unknown[]) => logEntries.push(entry) },
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(store.commitCount, 1);
  assert.ok(result.slots.every((slot) => slot.status === "AVAILABLE"));
  assert.equal(provider.restockNotifications.length, 1);
  assert.equal(JSON.stringify(logEntries).includes("line-secret-value"), false);
});

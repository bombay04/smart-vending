import assert from "node:assert/strict";
import test from "node:test";
import type {
  NotificationProvider,
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
  slots: [
    { slotNumber: 1, productName: "Tissue", status: "AVAILABLE" },
    { slotNumber: 2, productName: "Wet Wipes", status: "AVAILABLE" },
    { slotNumber: 3, productName: "Sanitary Pads", status: "AVAILABLE" },
  ],
};

class MemoryRestockStore implements RestockStore {
  notificationClaimed = false;
  commitCount = 0;

  constructor(private readonly failure: Error | null = null) {}

  async commitRestock(employeeId: number) {
    this.commitCount += 1;
    if (this.failure) throw this.failure;
    assert.equal(employeeId, committedRestock.employeeId);
    return structuredClone(committedRestock);
  }

  async claimRestockNotification(restockId: number) {
    assert.equal(restockId, committedRestock.restockId);
    if (this.notificationClaimed) return false;
    this.notificationClaimed = true;
    return true;
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

  const result = await createMockRestockWithDependencies(7, store, { provider });

  assert.deepEqual(result, committedRestock);
  assert.deepEqual(provider.restockNotifications, [{ slots: committedRestock.slots }]);
  assert.equal(store.notificationClaimed, true);
});

test("failed restock never claims or sends a notification", async () => {
  const store = new MemoryRestockStore(new HttpError("Employee is inactive.", 403));
  const provider = new MockNotificationProvider();

  await assert.rejects(
    createMockRestockWithDependencies(7, store, { provider }),
    (error: unknown) => error instanceof HttpError && error.statusCode === 403,
  );
  assert.equal(store.notificationClaimed, false);
  assert.equal(provider.restockNotifications.length, 0);
});

test("durable restock claim prevents duplicate notification handling", async () => {
  const store = new MemoryRestockStore();
  const provider = new MockNotificationProvider();
  const notifications = { provider };

  await createMockRestockWithDependencies(7, store, notifications);
  await createMockRestockWithDependencies(7, store, notifications);

  assert.equal(store.commitCount, 2);
  assert.equal(provider.restockNotifications.length, 1);
});

test("notification failure leaves the restock committed and slots available", async () => {
  const store = new MemoryRestockStore();
  const provider = new MockNotificationProvider(new Error("line-secret-value"));
  const logEntries: unknown[][] = [];

  const result = await createMockRestockWithDependencies(7, store, {
    provider,
    logger: { error: (...entry: unknown[]) => logEntries.push(entry) },
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(store.commitCount, 1);
  assert.ok(result.slots.every((slot) => slot.status === "AVAILABLE"));
  assert.equal(provider.restockNotifications.length, 1);
  assert.equal(JSON.stringify(logEntries).includes("line-secret-value"), false);
});

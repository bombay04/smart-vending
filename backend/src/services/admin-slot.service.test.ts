import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { HttpError } from "../utils/http-error";
import {
  type AdminSlotRecord,
  type AdminSlotStore,
  listAdminSlots,
  parsePhysicalSlotNumber,
  parseSlotConfiguration,
  updateAdminSlot,
} from "./admin-slot.service";

function slot(slotNumber: number, overrides: Partial<AdminSlotRecord> = {}): AdminSlotRecord {
  return {
    id: slotNumber,
    slotNumber,
    status: slotNumber === 3 ? "SOLD_OUT" : "AVAILABLE",
    product: {
      id: slotNumber,
      name: `Product ${slotNumber}`,
      price: "20.00",
      imageUrl: null,
      isActive: true,
    },
    ...overrides,
  };
}

class MemoryAdminSlotStore implements AdminSlotStore {
  slots = [slot(1), slot(2), slot(3)];

  async listPhysicalSlots() {
    return this.slots;
  }

  async configureSlot(
    slotNumber: number,
    configuration: Parameters<AdminSlotStore["configureSlot"]>[1],
  ) {
    const current = this.slots.find((item) => item.slotNumber === slotNumber);
    if (!current) throw new HttpError("Slot not found.", 404);
    const updated: AdminSlotRecord = {
      ...current,
      product: { id: 99, ...configuration },
    };
    this.slots = this.slots.map((item) => (item.slotNumber === slotNumber ? updated : item));
    return updated;
  }
}

test("management reads exactly physical slots 1 through 3", async () => {
  const result = await listAdminSlots(new MemoryAdminSlotStore());
  assert.deepEqual(
    result.map((item) => item.slotNumber),
    [1, 2, 3],
  );

  const incomplete = new MemoryAdminSlotStore();
  incomplete.slots.pop();
  await assert.rejects(
    listAdminSlots(incomplete),
    (error: unknown) => error instanceof HttpError && error.statusCode === 500,
  );
});

test("valid configuration updates product fields without changing SOLD_OUT inventory", async () => {
  const store = new MemoryAdminSlotStore();
  const updated = await updateAdminSlot(
    "3",
    { name: " Sandwich ", price: "35.5", imageUrl: "", isActive: false },
    store,
  );
  assert.equal(updated.status, "SOLD_OUT");
  assert.deepEqual(updated.product, {
    id: 99,
    name: "Sandwich",
    price: "35.50",
    imageUrl: null,
    isActive: false,
  });
});

test("invalid slot numbers are rejected before storage", () => {
  for (const value of [0, 4, -1, 1.5, "abc", "04"]) {
    assert.throws(
      () => parsePhysicalSlotNumber(value),
      (error: unknown) => error instanceof HttpError && error.statusCode === 400,
    );
  }
});

test("blank product names and invalid prices are rejected", () => {
  for (const body of [
    { name: " ", price: "20", imageUrl: null, isActive: true },
    { name: "Water", price: "0", imageUrl: null, isActive: true },
    { name: "Water", price: -1, imageUrl: null, isActive: true },
    { name: "Water", price: "NaN", imageUrl: null, isActive: true },
    { name: "Water", price: "20.001", imageUrl: null, isActive: true },
  ]) {
    assert.throws(
      () => parseSlotConfiguration(body),
      (error: unknown) => error instanceof HttpError && error.statusCode === 400,
    );
  }
});

test("optional image URL accepts empty or HTTPS and rejects unsafe schemes", () => {
  const base = { name: "Water", price: "20", isActive: true };
  assert.equal(parseSlotConfiguration({ ...base, imageUrl: "" }).imageUrl, null);
  assert.equal(
    parseSlotConfiguration({ ...base, imageUrl: "https://cdn.example/water.png" }).imageUrl,
    "https://cdn.example/water.png",
  );
  for (const imageUrl of ["http://example.test/a.png", "file:///C:/photo.png", "C:\\photo.png"]) {
    assert.throws(() => parseSlotConfiguration({ ...base, imageUrl }), HttpError);
  }
});

test("database update protects shared products, history, inventory, and active payments", async () => {
  const service = await readFile(resolve("src/services/admin-slot.service.ts"), "utf8");
  assert.match(service, /paymentStatus: "PENDING",\s*customerCancelledAt: null/);
  assert.match(service, /SLOT_PAYMENT_ACTIVE_CODE/);
  assert.match(service, /slot\.product\._count\.slots === 1/);
  assert.match(service, /slot\.product\._count\.transactions === 0/);
  assert.match(service, /database\.product\.create\(\{ data: configuration \}\)/);
  assert.match(service, /data: \{ productId: product\.id \}/);
  assert.doesNotMatch(service, /data: \{ status:/);
});

test("purchase authority rejects inactive products and snapshots the database price", async () => {
  const transaction = await readFile(resolve("src/services/transaction.service.ts"), "utf8");
  assert.match(transaction, /!slot\.product \|\| !slot\.product\.isActive/);
  assert.match(transaction, /productId: slot\.product\.id/);
  assert.match(transaction, /amount: slot\.product\.price/);
});

import type { Prisma } from "../../generated/prisma-client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/http-error";

export const PHYSICAL_SLOT_NUMBERS = [1, 2, 3] as const;
export const SLOT_PAYMENT_ACTIVE_CODE = "SLOT_PAYMENT_ACTIVE";

export interface SlotConfigurationInput {
  name: string;
  price: string;
  imageUrl: string | null;
  isActive: boolean;
}

export interface AdminSlotRecord {
  id: number;
  slotNumber: number;
  status: "AVAILABLE" | "SOLD_OUT";
  product: {
    id: number;
    name: string;
    price: string;
    imageUrl: string | null;
    isActive: boolean;
  } | null;
}

export interface AdminSlotStore {
  listPhysicalSlots(): Promise<AdminSlotRecord[]>;
  configureSlot(
    slotNumber: number,
    configuration: SlotConfigurationInput,
  ): Promise<AdminSlotRecord>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parsePhysicalSlotNumber(value: unknown): number {
  const slotNumber = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (
    typeof slotNumber !== "number" ||
    !Number.isInteger(slotNumber) ||
    !PHYSICAL_SLOT_NUMBERS.includes(slotNumber as (typeof PHYSICAL_SLOT_NUMBERS)[number])
  ) {
    throw new HttpError("Slot number must be one of 1, 2, or 3.", 400);
  }
  return slotNumber;
}

function parsePrice(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new HttpError("Price must be a positive THB amount.", 400);
  }
  const raw = typeof value === "number" ? String(value) : value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) {
    throw new HttpError("Price must be a positive THB amount with at most two decimals.", 400);
  }
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 99_999_999.99) {
    throw new HttpError("Price must be a positive THB amount.", 400);
  }
  return amount.toFixed(2);
}

function parseImageUrl(value: unknown): string | null {
  if (value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new HttpError("Image URL must be an HTTPS URL or empty.", 400);
  }
  const normalized = value.trim();
  if (normalized === "") return null;
  if (normalized.length > 2048) {
    throw new HttpError("Image URL is too long.", 400);
  }
  try {
    const url = new URL(normalized);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error();
  } catch {
    throw new HttpError("Image URL must be a valid HTTPS URL.", 400);
  }
  return normalized;
}

export function parseSlotConfiguration(body: unknown): SlotConfigurationInput {
  if (!isObject(body)) throw new HttpError("Invalid slot configuration.", 400);
  const allowed = new Set(["name", "price", "imageUrl", "isActive"]);
  if (Object.keys(body).some((key) => !allowed.has(key))) {
    throw new HttpError("Slot configuration contains unsupported fields.", 400);
  }
  if (typeof body.name !== "string" || body.name.trim() === "") {
    throw new HttpError("Product name must not be blank.", 400);
  }
  const name = body.name.trim();
  if (name.length > 120) throw new HttpError("Product name is too long.", 400);
  if (typeof body.isActive !== "boolean") {
    throw new HttpError("Product active status must be true or false.", 400);
  }
  return {
    name,
    price: parsePrice(body.price),
    imageUrl: parseImageUrl(body.imageUrl),
    isActive: body.isActive,
  };
}

function serializeSlot(slot: {
  id: number;
  slotNumber: number;
  status: "AVAILABLE" | "SOLD_OUT";
  product: null | {
    id: number;
    name: string;
    price: { toString(): string };
    imageUrl: string | null;
    isActive: boolean;
  };
}): AdminSlotRecord {
  return {
    ...slot,
    product: slot.product ? { ...slot.product, price: slot.product.price.toString() } : null,
  };
}

const slotSelection = {
  id: true,
  slotNumber: true,
  status: true,
  product: {
    select: { id: true, name: true, price: true, imageUrl: true, isActive: true },
  },
} satisfies Prisma.SlotSelect;

async function withSerializableRetry<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error: unknown) {
      if (
        attempt < 2 &&
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "P2034"
      ) {
        continue;
      }
      throw error;
    }
  }
  throw new Error("Unreachable serializable transaction retry state.");
}

export const prismaAdminSlotStore: AdminSlotStore = {
  async listPhysicalSlots() {
    const slots = await prisma.slot.findMany({
      where: { slotNumber: { in: [...PHYSICAL_SLOT_NUMBERS] } },
      orderBy: { slotNumber: "asc" },
      select: slotSelection,
    });
    if (slots.length !== PHYSICAL_SLOT_NUMBERS.length) {
      throw new HttpError("The three physical slots are not configured.", 500);
    }
    return slots.map(serializeSlot);
  },

  async configureSlot(slotNumber, configuration) {
    const operation = () =>
      prisma.$transaction(
        async (database) => {
          const slot = await database.slot.findUnique({
            where: { slotNumber },
            include: {
              product: {
                include: { _count: { select: { slots: true, transactions: true } } },
              },
            },
          });
          if (!slot) throw new HttpError("Slot not found.", 404);

          const activePayment = await database.transaction.findFirst({
            where: {
              slotId: slot.id,
              paymentStatus: "PENDING",
              customerCancelledAt: null,
            },
            select: { id: true },
          });
          if (activePayment) {
            throw new HttpError(
              "This slot has an active payment. Try again after it finishes.",
              409,
              SLOT_PAYMENT_ACTIVE_CODE,
            );
          }

          const unchanged =
            slot.product !== null &&
            slot.product.name === configuration.name &&
            slot.product.price.toFixed(2) === configuration.price &&
            slot.product.imageUrl === configuration.imageUrl &&
            slot.product.isActive === configuration.isActive;

          if (!unchanged) {
            if (
              slot.product !== null &&
              slot.product._count.slots === 1 &&
              slot.product._count.transactions === 0
            ) {
              await database.product.update({
                where: { id: slot.product.id },
                data: configuration,
              });
            } else {
              const product = await database.product.create({ data: configuration });
              await database.slot.update({
                where: { id: slot.id },
                data: { productId: product.id },
              });
            }
          }

          const updated = await database.slot.findUniqueOrThrow({
            where: { id: slot.id },
            select: slotSelection,
          });
          return serializeSlot(updated);
        },
        { isolationLevel: "Serializable" },
      );
    return withSerializableRetry(operation);
  },
};

export async function listAdminSlots(store: AdminSlotStore = prismaAdminSlotStore) {
  const slots = await store.listPhysicalSlots();
  if (
    slots.length !== PHYSICAL_SLOT_NUMBERS.length ||
    slots.some((slot, index) => slot.slotNumber !== PHYSICAL_SLOT_NUMBERS[index])
  ) {
    throw new HttpError("The three physical slots are not configured.", 500);
  }
  return slots;
}

export async function updateAdminSlot(
  slotNumberValue: unknown,
  body: unknown,
  store: AdminSlotStore = prismaAdminSlotStore,
) {
  const slotNumber = parsePhysicalSlotNumber(slotNumberValue);
  const configuration = parseSlotConfiguration(body);
  return store.configureSlot(slotNumber, configuration);
}

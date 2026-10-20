import { prisma } from "../lib/prisma";
import {
  dispatchRestockNotification,
  type NotificationDependencies,
} from "../notifications/notification-dispatch";
import { getNotificationProvider } from "../notifications/line-notification.provider";
import type {
  ProductStatusNotificationSlot,
  RestockNotificationEmployee,
} from "../notifications/notification-provider";
import { HttpError } from "../utils/http-error";
import { PILOT_KIOSK_MACHINE_ID } from "./kiosk-session.service";

const requiredSlotNumbers = [1, 2, 3];

export interface RestockedSlot {
  slotNumber: number;
  productName: string | null;
  status: "AVAILABLE";
}

export interface RestockResult {
  restockId: number;
  employeeId: number;
  employee: RestockNotificationEmployee;
  slots: RestockedSlot[];
}

export interface RestockStore {
  commitRestock(sessionId: number): Promise<RestockResult>;
  claimRestockNotification(restockId: number): Promise<boolean>;
  listRestockNotificationSlots(): Promise<ProductStatusNotificationSlot[]>;
}

const prismaRestockStore: RestockStore = {
  async commitRestock(sessionId) {
    return prisma.$transaction(async (transaction) => {
      const now = new Date();
      const session = await transaction.kioskSession.findUnique({
        where: { id: sessionId },
        include: {
          employee: {
            select: { id: true, employeeCode: true, name: true, isActive: true },
          },
        },
      });
      if (
        !session ||
        session.machineId !== PILOT_KIOSK_MACHINE_ID ||
        session.type !== "RESTOCK_AUTH" ||
        session.status !== "ACTIVE" ||
        session.expiresAt <= now
      ) {
        if (session?.status === "ACTIVE" && session.expiresAt <= now) {
          await transaction.kioskSession.update({
            where: { id: session.id },
            data: { status: "EXPIRED" },
          });
        }
        throw new HttpError("A valid active restock session is required.", 403);
      }
      const verifiedEmployee = session.employee;
      if (!verifiedEmployee || session.employeeId !== verifiedEmployee.id) {
        throw new HttpError("A verified restock employee is required.", 403);
      }
      if (!verifiedEmployee.isActive) {
        throw new HttpError("Employee is inactive.", 403);
      }

      const slots = await transaction.slot.findMany({
        orderBy: { slotNumber: "asc" },
        include: { product: true },
      });
      const requiredSlots = slots.filter((slot) => requiredSlotNumbers.includes(slot.slotNumber));

      if (
        requiredSlots.length !== requiredSlotNumbers.length ||
        !requiredSlotNumbers.every((slotNumber) =>
          requiredSlots.some((slot) => slot.slotNumber === slotNumber),
        )
      ) {
        throw new HttpError("Required slots 1, 2, and 3 are not available.", 409);
      }

      const beforeStatus = requiredSlots.map((slot) => ({
        slotNumber: slot.slotNumber,
        status: slot.status,
      }));
      const afterStatus = requiredSlots.map((slot) => ({
        slotNumber: slot.slotNumber,
        status: "AVAILABLE" as const,
      }));

      await transaction.slot.updateMany({
        where: { slotNumber: { in: requiredSlotNumbers } },
        data: { status: "AVAILABLE" },
      });

      const restockLog = await transaction.restockLog.create({
        data: {
          employeeId: verifiedEmployee.id,
          note: "Mock restock",
          beforeStatus,
          afterStatus,
        },
      });

      await transaction.kioskSession.update({
        where: { id: session.id },
        data: { status: "COMPLETED", completedAt: now },
      });

      return {
        restockId: restockLog.id,
        employeeId: verifiedEmployee.id,
        employee: {
          employeeCode: verifiedEmployee.employeeCode,
          name: verifiedEmployee.name,
        },
        slots: requiredSlots.map((slot) => ({
          slotNumber: slot.slotNumber,
          productName: slot.product?.name ?? null,
          status: "AVAILABLE" as const,
        })),
      };
    });
  },

  async claimRestockNotification(restockId) {
    const result = await prisma.restockLog.updateMany({
      where: { id: restockId, notificationAttemptedAt: null },
      data: { notificationAttemptedAt: new Date() },
    });
    return result.count === 1;
  },

  async listRestockNotificationSlots() {
    const slots = await prisma.slot.findMany({
      orderBy: { slotNumber: "asc" },
      include: { product: true },
    });
    return slots.map((slot) => ({
      slotNumber: slot.slotNumber,
      productName: slot.product?.name ?? null,
      status: slot.status,
    }));
  },
};

export async function createMockRestockWithDependencies(
  sessionId: number,
  store: RestockStore,
  notifications?: NotificationDependencies,
): Promise<RestockResult> {
  const restock = await store.commitRestock(sessionId);

  if (notifications) {
    let slots: ProductStatusNotificationSlot[];
    try {
      slots = await store.listRestockNotificationSlots();
    } catch {
      (notifications.logger ?? console).error(
        "Unable to read post-restock inventory for notification.",
        {
          entityId: restock.restockId,
          event: "RESTOCK",
        },
      );
      return restock;
    }

    await dispatchRestockNotification(
      restock.restockId,
      { employee: restock.employee, slots },
      () => store.claimRestockNotification(restock.restockId),
      notifications,
    );
  }

  return restock;
}

export function createMockRestock(sessionId: number): Promise<RestockResult> {
  return createMockRestockWithDependencies(sessionId, prismaRestockStore, {
    provider: getNotificationProvider(),
  });
}

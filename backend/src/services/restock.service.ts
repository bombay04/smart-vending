import { prisma } from "../lib/prisma";
import {
  dispatchRestockNotification,
  type NotificationDependencies,
} from "../notifications/notification-dispatch";
import { getNotificationProvider } from "../notifications/line-notification.provider";
import { HttpError } from "../utils/http-error";

const requiredSlotNumbers = [1, 2, 3];

export interface RestockedSlot {
  slotNumber: number;
  productName: string | null;
  status: "AVAILABLE";
}

export interface RestockResult {
  restockId: number;
  employeeId: number;
  slots: RestockedSlot[];
}

export interface RestockStore {
  commitRestock(employeeId: number): Promise<RestockResult>;
  claimRestockNotification(restockId: number): Promise<boolean>;
}

const prismaRestockStore: RestockStore = {
  async commitRestock(employeeId) {
    return prisma.$transaction(async (transaction) => {
      const employee = await transaction.employee.findUnique({
        where: { id: employeeId },
      });

      if (!employee) {
        throw new HttpError("Employee not found.", 404);
      }

      if (!employee.isActive) {
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
          employeeId,
          note: "Mock restock",
          beforeStatus,
          afterStatus,
        },
      });

      return {
        restockId: restockLog.id,
        employeeId,
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
};

export async function createMockRestockWithDependencies(
  employeeId: number,
  store: RestockStore,
  notifications?: NotificationDependencies,
): Promise<RestockResult> {
  const restock = await store.commitRestock(employeeId);

  if (notifications) {
    await dispatchRestockNotification(
      restock.restockId,
      { slots: restock.slots },
      () => store.claimRestockNotification(restock.restockId),
      notifications,
    );
  }

  return restock;
}

export function createMockRestock(employeeId: number): Promise<RestockResult> {
  return createMockRestockWithDependencies(employeeId, prismaRestockStore, {
    provider: getNotificationProvider(),
  });
}

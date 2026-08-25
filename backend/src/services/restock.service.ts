import { prisma } from "../lib/prisma";

const requiredSlotNumbers = [1, 2, 3];

export class MockRestockError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "MockRestockError";
  }
}

export async function createMockRestock(employeeId: number) {
  return prisma.$transaction(async (transaction) => {
    const employee = await transaction.employee.findUnique({
      where: { id: employeeId },
    });

    if (!employee) {
      throw new MockRestockError("Employee not found.", 404);
    }

    if (!employee.isActive) {
      throw new MockRestockError("Employee is inactive.", 403);
    }

    const slots = await transaction.slot.findMany({
      orderBy: { slotNumber: "asc" },
    });
    const requiredSlots = slots.filter((slot) => requiredSlotNumbers.includes(slot.slotNumber));

    if (
      requiredSlots.length !== requiredSlotNumbers.length ||
      !requiredSlotNumbers.every((slotNumber) =>
        requiredSlots.some((slot) => slot.slotNumber === slotNumber),
      )
    ) {
      throw new MockRestockError("Required slots 1, 2, and 3 are not available.", 409);
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
      slots: afterStatus,
    };
  });
}

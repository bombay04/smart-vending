import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/http-error";

export async function createMockPurchase(slotNumber: number) {
  return prisma.$transaction(async (transaction) => {
    const slot = await transaction.slot.findUnique({
      where: { slotNumber },
      include: { product: true },
    });

    if (!slot) {
      throw new HttpError("Slot not found.", 404);
    }

    if (!slot.product) {
      throw new HttpError("Slot has no product.", 400);
    }

    if (slot.status === "SOLD_OUT") {
      throw new HttpError("Slot is sold out.", 409);
    }

    const purchase = await transaction.transaction.create({
      data: {
        slotId: slot.id,
        productId: slot.product.id,
        amount: slot.product.price,
        paymentStatus: "SUCCESS",
        paymentProvider: "OPN",
        paidAt: new Date(),
      },
    });

    const updatedSlot = await transaction.slot.update({
      where: { id: slot.id },
      data: { status: "SOLD_OUT" },
    });

    return {
      transactionId: purchase.id,
      slotNumber: slot.slotNumber,
      productName: slot.product.name,
      amount: purchase.amount.toString(),
      paymentStatus: purchase.paymentStatus,
      slotStatus: updatedSlot.status,
    };
  });
}

import { prisma } from "../lib/prisma";

export async function getSlots() {
  const slots = await prisma.slot.findMany({
    orderBy: { slotNumber: "asc" },
    select: {
      id: true,
      slotNumber: true,
      status: true,
      product: {
        select: {
          id: true,
          name: true,
          price: true,
          imageUrl: true,
        },
      },
    },
  });

  return slots.map((slot) => ({
    ...slot,
    product: slot.product
      ? {
          ...slot.product,
          price: slot.product.price.toString(),
        }
      : null,
  }));
}

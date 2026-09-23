import { SlotStatus } from "@prisma/client";
import { prisma } from "../src/lib/prisma";

const products = [
  { name: "Tissue", price: "20.00", slotNumber: 1 },
  { name: "Sanitary Pad", price: "25.00", slotNumber: 2 },
  { name: "Wet Wipes", price: "30.00", slotNumber: 3 },
] as const;

async function main(): Promise<void> {
  await prisma.$transaction(async (transaction) => {
    await transaction.employee.upsert({
      where: { employeeCode: "EMP001" },
      update: {
        name: "Prototype Employee",
        isActive: true,
      },
      create: {
        name: "Prototype Employee",
        employeeCode: "EMP001",
        isActive: true,
        faceRegistered: false,
      },
    });

    for (const productData of products) {
      const existingProduct = await transaction.product.findFirst({
        where: { name: productData.name },
      });

      const product = existingProduct
        ? await transaction.product.update({
            where: { id: existingProduct.id },
            data: {
              price: productData.price,
              isActive: true,
            },
          })
        : await transaction.product.create({
            data: {
              name: productData.name,
              price: productData.price,
            },
          });

      await transaction.slot.upsert({
        where: { slotNumber: productData.slotNumber },
        update: {
          status: SlotStatus.AVAILABLE,
          productId: product.id,
        },
        create: {
          slotNumber: productData.slotNumber,
          status: SlotStatus.AVAILABLE,
          productId: product.id,
        },
      });
    }
  });
}

main()
  .catch((error: unknown) => {
    console.error("Failed to seed initial data:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

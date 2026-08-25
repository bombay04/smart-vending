import { prisma } from "../lib/prisma";

export async function getActiveProducts() {
  const products = await prisma.product.findMany({
    where: { isActive: true },
    orderBy: { id: "asc" },
    select: {
      id: true,
      name: true,
      price: true,
      imageUrl: true,
      isActive: true,
    },
  });

  return products.map((product) => ({
    ...product,
    price: product.price.toString(),
  }));
}

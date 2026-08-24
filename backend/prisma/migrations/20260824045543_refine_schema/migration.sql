/*
  Warnings:

  - Changed the type of `paymentProvider` on the `Transaction` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('OPN');

-- AlterTable
ALTER TABLE "RestockLog" ADD COLUMN     "afterStatus" JSONB,
ADD COLUMN     "beforeStatus" JSONB;

-- AlterTable
ALTER TABLE "Transaction" DROP COLUMN "paymentProvider",
ADD COLUMN     "paymentProvider" "PaymentProvider" NOT NULL;

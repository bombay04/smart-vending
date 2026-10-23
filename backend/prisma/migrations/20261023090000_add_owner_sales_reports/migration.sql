BEGIN;

-- Preserve the product label used when a transaction is created. Existing
-- history can only be backfilled from the currently related product name.
ALTER TABLE "Transaction"
ADD COLUMN "productNameSnapshot" TEXT,
ADD COLUMN "providerLiveMode" BOOLEAN;

UPDATE "Transaction" AS t
SET "productNameSnapshot" = p."name"
FROM "Product" AS p
WHERE t."productId" = p."id";

-- Existing Opn test charges carry the chrg_test_ prefix. New payments persist
-- the provider's authoritative livemode field directly.
UPDATE "Transaction"
SET "providerLiveMode" = CASE
  WHEN LOWER("providerChargeId") LIKE 'chrg_test_%' THEN false
  WHEN "providerChargeId" IS NOT NULL THEN true
  ELSE NULL
END;

CREATE INDEX "Transaction_paymentStatus_paidAt_idx"
ON "Transaction"("paymentStatus", "paidAt");

-- A small delivery ledger gives each report period one durable identity.
-- Failed attempts can be retried; stale SENDING claims can be reclaimed.
CREATE TYPE "SalesReportType" AS ENUM ('DAILY', 'WEEKLY');
CREATE TYPE "SalesReportDeliveryStatus" AS ENUM ('SENDING', 'SENT', 'FAILED', 'MANUAL_REVIEW');
CREATE TYPE "SalesReportDataMode" AS ENUM ('LIVE', 'DEMO_TEST');

CREATE TABLE "SalesReportDelivery" (
    "id" SERIAL NOT NULL,
    "reportType" "SalesReportType" NOT NULL,
    "dataMode" "SalesReportDataMode" NOT NULL DEFAULT 'LIVE',
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "status" "SalesReportDeliveryStatus" NOT NULL DEFAULT 'SENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 1,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retryKey" TEXT NOT NULL,
    "retryKeyCreatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payloadSnapshot" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "lineRequestId" TEXT,
    "lineAcceptedRequestId" TEXT,
    "lastErrorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SalesReportDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SalesReportDelivery_retryKey_key"
ON "SalesReportDelivery"("retryKey");

CREATE UNIQUE INDEX "SalesReportDelivery_reportType_dataMode_periodStart_key"
ON "SalesReportDelivery"("reportType", "dataMode", "periodStart");

CREATE INDEX "SalesReportDelivery_status_claimedAt_idx"
ON "SalesReportDelivery"("status", "claimedAt");

COMMIT;

-- Durable one-shot claims prevent duplicate LINE sends when payment status or
-- restock completion is handled repeatedly. Existing completed operations are
-- backfilled so deploying this migration does not emit historical notices.
ALTER TABLE "Transaction"
ADD COLUMN "saleNotificationAttemptedAt" TIMESTAMP(3);

ALTER TABLE "RestockLog"
ADD COLUMN "notificationAttemptedAt" TIMESTAMP(3);

UPDATE "Transaction"
SET "saleNotificationAttemptedAt" = COALESCE("paidAt", "updatedAt")
WHERE "paymentStatus" = 'SUCCESS';

UPDATE "RestockLog"
SET "notificationAttemptedAt" = "createdAt";

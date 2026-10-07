-- Customer abandonment is separate from the Opn payment status. A provider
-- charge may still complete after the kiosk purchase flow has been abandoned.
ALTER TABLE "Transaction"
ADD COLUMN "customerCancelledAt" TIMESTAMP(3);

-- Store the provider's authoritative status and QR expiry, and prevent a
-- provider charge from being attached to more than one local transaction.
ALTER TABLE "Transaction"
ADD COLUMN "providerStatus" TEXT,
ADD COLUMN "expiresAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Transaction_providerChargeId_key"
ON "Transaction"("providerChargeId");

BEGIN;

CREATE TYPE "MachineConnectivityStatus" AS ENUM ('ONLINE', 'OFFLINE');
CREATE TYPE "HardwareAlertTransition" AS ENUM ('OFFLINE', 'RECOVERED');
CREATE TYPE "HardwareAlertSeverity" AS ENUM ('CRITICAL', 'RECOVERED');
CREATE TYPE "HardwareAlertDeliveryStatus" AS ENUM (
  'PENDING',
  'SENDING',
  'SENT',
  'FAILED',
  'MANUAL_REVIEW'
);

CREATE TABLE "HardwareMachine" (
  "machineId" TEXT NOT NULL,
  "connectivity" "MachineConnectivityStatus" NOT NULL DEFAULT 'ONLINE',
  "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastHeartbeatAt" TIMESTAMP(3) NOT NULL,
  "lastObservedAt" TIMESTAMP(3) NOT NULL,
  "lastSequence" BIGINT NOT NULL,
  "offlineCandidateSince" TIMESTAMP(3),
  "lastEvaluatedAt" TIMESTAMP(3),
  "offlineSince" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HardwareMachine_pkey" PRIMARY KEY ("machineId")
);

CREATE TABLE "HardwareAlertEvent" (
  "id" BIGSERIAL NOT NULL,
  "machineId" TEXT NOT NULL,
  "transition" "HardwareAlertTransition" NOT NULL,
  "severity" "HardwareAlertSeverity" NOT NULL,
  "detectedAt" TIMESTAMP(3) NOT NULL,
  "description" TEXT NOT NULL,
  "recommendedAction" TEXT NOT NULL,
  "payloadSnapshot" TEXT NOT NULL,
  "retryKey" TEXT NOT NULL,
  "retryKeyCreatedAt" TIMESTAMP(3) NOT NULL,
  "deliveryStatus" "HardwareAlertDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "claimedAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "lineRequestId" TEXT,
  "lineAcceptedRequestId" TEXT,
  "lastErrorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HardwareAlertEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "HardwareMachine_connectivity_lastHeartbeatAt_idx"
  ON "HardwareMachine"("connectivity", "lastHeartbeatAt");
CREATE UNIQUE INDEX "HardwareAlertEvent_retryKey_key"
  ON "HardwareAlertEvent"("retryKey");
CREATE INDEX "HardwareAlertEvent_deliveryStatus_retryKeyCreatedAt_claimedAt_idx"
  ON "HardwareAlertEvent"("deliveryStatus", "retryKeyCreatedAt", "claimedAt");
CREATE INDEX "HardwareAlertEvent_machineId_transition_detectedAt_idx"
  ON "HardwareAlertEvent"("machineId", "transition", "detectedAt");

ALTER TABLE "HardwareAlertEvent"
  ADD CONSTRAINT "HardwareAlertEvent_machineId_fkey"
  FOREIGN KEY ("machineId") REFERENCES "HardwareMachine"("machineId")
  ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;

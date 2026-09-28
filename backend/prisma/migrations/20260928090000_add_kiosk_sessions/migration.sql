CREATE TYPE "KioskSessionType" AS ENUM ('RESTOCK_AUTH', 'FACE_REGISTRATION');
CREATE TYPE "KioskSessionStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'EXPIRED', 'CANCELLED');

CREATE TABLE "KioskSession" (
    "id" SERIAL NOT NULL,
    "machineId" TEXT NOT NULL,
    "type" "KioskSessionType" NOT NULL,
    "status" "KioskSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "employeeId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "KioskSession_employee_binding_check" CHECK (
      ("type" = 'FACE_REGISTRATION' AND "employeeId" IS NOT NULL) OR
      ("type" = 'RESTOCK_AUTH' AND "employeeId" IS NULL)
    ),
    CONSTRAINT "KioskSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "KioskSession_machineId_status_expiresAt_idx"
ON "KioskSession"("machineId", "status", "expiresAt");
CREATE INDEX "KioskSession_employeeId_idx" ON "KioskSession"("employeeId");

-- PostgreSQL enforces one ACTIVE owner for the pilot kiosk. Application
-- transactions mark elapsed rows EXPIRED before attempting a new insert.
CREATE UNIQUE INDEX "KioskSession_one_active_per_machine"
ON "KioskSession"("machineId") WHERE "status" = 'ACTIVE';

ALTER TABLE "KioskSession" ADD CONSTRAINT "KioskSession_employeeId_fkey"
FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

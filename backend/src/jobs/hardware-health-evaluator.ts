import {
  deliverPendingHardwareAlerts,
  evaluateOfflineMachines,
} from "../hardware/hardware-monitoring.service";
import { prisma } from "../lib/prisma";

async function main(): Promise<void> {
  const transitions = await evaluateOfflineMachines();
  const delivery = await deliverPendingHardwareAlerts();
  console.log(
    `Hardware health evaluation complete; offline transitions=${transitions}, sent=${delivery.sent}, failed=${delivery.failed}, manualReview=${delivery.manualReview}.`,
  );
}

void main()
  .catch((error: unknown) => {
    console.error(
      "Hardware health evaluation failed.",
      error instanceof Error ? error.message : "unknown",
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

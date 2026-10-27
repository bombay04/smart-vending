import app from "./app";
import { startHardwareHealthLoop } from "./hardware/hardware-health-loop";
import { prisma } from "./lib/prisma";

const port = process.env.PORT ?? 3000;

const server = app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

const hardwareHealthLoop = startHardwareHealthLoop();
console.log("Hardware health loop started; interval=30 seconds.");
let shuttingDown = false;

async function performShutdown(signal: NodeJS.Signals): Promise<void> {
  console.log(`Received ${signal}; stopping server.`);
  const serverStopped = new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
  await hardwareHealthLoop.stop();
  await serverStopped;
  await prisma.$disconnect();
}

function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  void performShutdown(signal).catch(() => {
    console.error("Backend shutdown failed.");
    process.exitCode = 1;
  });
}

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);

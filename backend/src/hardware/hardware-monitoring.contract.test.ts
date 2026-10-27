import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

test("offline-only migration is atomic, additive, and durable", async () => {
  const migration = await readFile(
    resolve("prisma/migrations/20261026130000_add_hardware_monitoring/migration.sql"),
    "utf8",
  );
  assert.match(migration, /^BEGIN;/);
  assert.match(migration, /COMMIT;\s*$/);
  assert.match(migration, /"lastSequence" BIGINT NOT NULL/);
  assert.match(migration, /UNIQUE INDEX "HardwareAlertEvent_retryKey_key"/);
  assert.match(migration, /'MANUAL_REVIEW'/);
  assert.match(migration, /"retryKeyCreatedAt" TIMESTAMP\(3\) NOT NULL/);
  assert.doesNotMatch(
    migration,
    /HardwareHeartbeat|HardwareFaultState|piServiceHealthy|esp32Status|slotNumber/,
  );
  assert.doesNotMatch(
    migration,
    /ALTER TABLE "(?:Product|Slot|Transaction|Employee|RestockLog|KioskSession|SalesReportDelivery)"/,
  );
});

test("first heartbeat enrolls online without an alert and server receive time is authoritative", async () => {
  const service = await readFile(resolve("src/hardware/hardware-monitoring.service.ts"), "utf8");
  const enrollment = service.slice(
    service.indexOf("if (!machine)"),
    service.indexOf("if (isHeartbeatStale"),
  );
  assert.match(enrollment, /connectivity: "ONLINE"/);
  assert.match(enrollment, /lastHeartbeatAt: receivedAt/);
  assert.doesNotMatch(enrollment, /createConnectivityAlert/);
});

test("controller rejects a heartbeat body that does not match the authenticated machine", async () => {
  const controller = await readFile(resolve("src/controllers/hardware.controller.ts"), "utf8");
  assert.match(controller, /heartbeat\.machineId !== response\.locals\.machineId/);
  assert.match(controller, /status\(403\)/);
  assert.match(controller, /does not match its credential/);
});

test("offline and recovery transitions are atomically guarded against concurrency", async () => {
  const service = await readFile(resolve("src/hardware/hardware-monitoring.service.ts"), "utf8");
  assert.match(service, /TransactionIsolationLevel\.Serializable/);
  assert.match(service, /hardwareMachine\.updateMany\([\s\S]*connectivity: "ONLINE"/);
  assert.match(service, /if \(claimed\.count !== 1\) return false/);
  assert.match(service, /machine\.connectivity === "OFFLINE"/);
  assert.match(service, /transition: "RECOVERED"/);
});

test("long-running backend starts one bounded health loop while Cron reuses only its cycle", async () => {
  const [server, loop, cron] = await Promise.all([
    readFile(resolve("src/server.ts"), "utf8"),
    readFile(resolve("src/hardware/hardware-health-loop.ts"), "utf8"),
    readFile(resolve("src/jobs/hardware-health-evaluator.ts"), "utf8"),
  ]);
  assert.match(server, /startHardwareHealthLoop\(\)/);
  assert.match(server, /hardwareHealthLoop[\s\S]*\.stop\(\)/);
  assert.match(loop, /HARDWARE_HEALTH_LOOP_INTERVAL_MS = 30_000/);
  assert.match(loop, /\.finally\([\s\S]*schedule\(intervalMs\)/);
  assert.match(cron, /runHardwareHealthCycle\(\)/);
  assert.doesNotMatch(cron, /startHardwareHealthLoop/);
});

test("heartbeat response is independent of LINE delivery and recovery remains durable", async () => {
  const [controller, service, loop] = await Promise.all([
    readFile(resolve("src/controllers/hardware.controller.ts"), "utf8"),
    readFile(resolve("src/hardware/hardware-monitoring.service.ts"), "utf8"),
    readFile(resolve("src/hardware/hardware-health-loop.ts"), "utf8"),
  ]);
  assert.match(controller, /response\.status\(202\)\.json/);
  assert.doesNotMatch(controller, /deliverPendingHardwareAlerts|provider\.send/);
  assert.match(service, /if \(recovered\)[\s\S]*createConnectivityAlert/);
  assert.match(loop, /deliverPendingHardwareAlerts/);
});

test("LINE retries use the immutable snapshot and key with bounded manual review", async () => {
  const service = await readFile(resolve("src/hardware/hardware-monitoring.service.ts"), "utf8");
  assert.match(service, /getMaintenanceAlertProvider\(\)/);
  assert.doesNotMatch(service, /getOwnerReportProvider|LINE_OWNER_CHANNEL_ACCESS_TOKEN/);
  assert.match(service, /provider\.send\(event\.payloadSnapshot, event\.retryKey\)/);
  assert.match(service, /attemptCount: \{ lt: HARDWARE_ALERT_MAX_ATTEMPTS \}/);
  assert.match(service, /deliveryStatus: "MANUAL_REVIEW"/);
  assert.match(service, /retryKeyCreatedAt: \{ lte: expiredBefore \}/);
  assert.match(service, /error instanceof OwnerReportDeliveryError/);
});

test("maintenance provider and environment example prohibit owner-token fallback", async () => {
  const [provider, environment] = await Promise.all([
    readFile(resolve("src/hardware/maintenance-line-alert.provider.ts"), "utf8"),
    readFile(resolve(".env.example"), "utf8"),
  ]);
  assert.match(provider, /LINE_MAINTENANCE_CHANNEL_ACCESS_TOKEN/);
  assert.doesNotMatch(provider, /LINE_OWNER_CHANNEL_ACCESS_TOKEN/);
  assert.match(environment, /LINE_MAINTENANCE_CHANNEL_ACCESS_TOKEN=/);
  assert.match(environment, /Hardware monitoring never falls back to the owner/);
});

test("heartbeat worker has no local hardware, serial, unlock, or Chromium dependency", async () => {
  const relay = await readFile(resolve("../edge/pi_cloud_relay.py"), "utf8");
  const worker = relay.slice(
    relay.indexOf("class HardwareHeartbeatWorker"),
    relay.indexOf("def _is_json_content_type"),
  );
  assert.match(worker, /"version": 1/);
  assert.match(worker, /"observedAt": datetime\.fromtimestamp/);
  assert.doesNotMatch(
    worker,
    /HTTPConnection|\/hardware\/status|\/monitoring\/snapshot|serial\.Serial|Esp32SerialClient|serial_operation_lock|OPEN:|PI_UNLOCK_PORT|chromium/i,
  );

  const unlockService = await readFile(resolve("../edge/pi_unlock_service.py"), "utf8");
  assert.doesNotMatch(unlockService, /\/monitoring\/snapshot|monitoring_unlock_events/);
});

test("monitoring cannot mutate business or unlock state", async () => {
  const service = await readFile(resolve("src/hardware/hardware-monitoring.service.ts"), "utf8");
  assert.doesNotMatch(
    service,
    /database\.(?:slot|product|transaction|employee|restockLog|kioskSession)\.(?:create|update|updateMany|delete)/,
  );
  assert.doesNotMatch(service, /open_slot|OPEN:|\/unlock|serial_client|serial_operation_lock/i);
});

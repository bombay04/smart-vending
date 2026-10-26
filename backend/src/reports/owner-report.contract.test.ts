import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

test("owner report scripts preserve explicit dry-run and send separation", () => {
  const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  assert.equal(packageJson.scripts["report:daily:preview"].includes("--send"), false);
  assert.equal(packageJson.scripts["report:weekly:preview"].includes("--send"), false);
  assert.match(packageJson.scripts["report:daily:send"], /daily --send$/);
  assert.match(packageJson.scripts["report:weekly:send"], /weekly --send$/);
  assert.equal(packageJson.scripts["report:daily:demo:preview"].includes("--send"), false);
  assert.equal(packageJson.scripts["report:weekly:demo:preview"].includes("--send"), false);
  assert.match(packageJson.scripts["report:daily:demo:send"], /daily --demo --send$/);
  assert.match(packageJson.scripts["report:weekly:demo:send"], /weekly --demo --send$/);
  assert.equal(packageJson.scripts["report:daily:scheduled:preview"].includes("--send"), false);
  assert.equal(packageJson.scripts["report:weekly:scheduled:preview"].includes("--send"), false);
  assert.match(packageJson.scripts["report:daily:scheduled:send"], /daily --scheduled --send$/);
  assert.match(packageJson.scripts["report:weekly:scheduled:send"], /weekly --scheduled --send$/);
});

test("delivery ledger separates LIVE and DEMO and persists safe retry state", () => {
  const schema = readFileSync(resolve(process.cwd(), "prisma/schema.prisma"), "utf8");
  const migration = readFileSync(
    resolve(
      process.cwd(),
      "prisma/migrations/20261023090000_add_owner_sales_reports/migration.sql",
    ),
    "utf8",
  );
  assert.match(schema, /@@unique\(\[reportType, dataMode, periodStart\]\)/);
  assert.match(schema, /retryKey\s+String\s+@unique/);
  assert.match(schema, /payloadSnapshot\s+String/);
  assert.match(migration, /^BEGIN;/);
  assert.match(migration, /"reportType", "dataMode", "periodStart"/);
  assert.match(migration, /COMMIT;\s*$/);
});

test("employee LINE configuration remains independent from owner reports", () => {
  const employeeProvider = readFileSync(
    resolve(process.cwd(), "src/notifications/line-notification.provider.ts"),
    "utf8",
  );
  const ownerProvider = readFileSync(
    resolve(process.cwd(), "src/reports/owner-line-report.provider.ts"),
    "utf8",
  );
  assert.match(employeeProvider, /process\.env\.LINE_CHANNEL_ACCESS_TOKEN/);
  assert.doesNotMatch(employeeProvider, /LINE_OWNER_CHANNEL_ACCESS_TOKEN/);
  assert.match(ownerProvider, /process\.env\.LINE_OWNER_CHANNEL_ACCESS_TOKEN/);
  assert.doesNotMatch(ownerProvider, /process\.env\.LINE_CHANNEL_ACCESS_TOKEN/);
});

test("Railway instructions define Bangkok 08:00 schedules in UTC", () => {
  const deploymentGuide = readFileSync(
    resolve(process.cwd(), "../docs/phase2-owner-sales-reports.md"),
    "utf8",
  );
  assert.match(deploymentGuide, /Daily.*`0 1 \* \* \*`/);
  assert.match(deploymentGuide, /Weekly.*`0 1 \* \* 1`/);
  assert.match(deploymentGuide, /Asia\/Bangkok/);
  assert.match(deploymentGuide, /OWNER_REPORT_SCHEDULED_DATA_MODE=DEMO_TEST/);
  assert.match(deploymentGuide, /report:daily:scheduled:send/);
  assert.match(deploymentGuide, /report:weekly:scheduled:send/);
});

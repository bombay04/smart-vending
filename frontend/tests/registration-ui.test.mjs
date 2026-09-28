import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("the staff portal remotely starts bounded kiosk sessions", async () => {
  const [app, portal] = await Promise.all([
    source("src/App.tsx"),
    source("src/components/StaffPortal.tsx"),
  ]);

  assert.match(app, /STAFF_PORTAL_PATH = "\/staff"/);
  assert.match(app, /<StaffPortal/);
  assert.match(portal, /id="staff-employee-name"/);
  assert.match(portal, /fetchEmployeesForFaceRegistration/);
  assert.match(portal, /createEmployee\(name/);
  assert.match(portal, /Face Setup Required/);
  assert.doesNotMatch(portal, /registerEmployeeFace/);
  assert.match(portal, /Start Face Registration/);
  assert.match(portal, /Start Restock/);
  assert.match(portal, /cancelKioskSession/);
});

test("local face setup uses the session-bound employee and metadata-only sync recovery", async () => {
  const registration = await source(
    "src/components/EmployeeFaceRegistration.tsx",
  );

  assert.doesNotMatch(registration, /Select an employee/);
  assert.match(registration, /registerEmployeeFace\(employee\.employeeCode/);
  assert.match(registration, /completeEmployeeFaceRegistration/);
  assert.match(
    registration,
    /await registerEmployeeFace[\s\S]*await syncCompletion/,
  );
  assert.match(registration, /authorizedSession\?\.id !== session\.id/);
  assert.match(registration, /retryCapture/);
  assert.match(registration, /SYNC_ERROR/);
  assert.match(registration, /Retry Status Sync/);
  assert.doesNotMatch(registration, /type="text"/);
});

test("customer Home does not expose staff or admin registration navigation", async () => {
  const home = await source("src/pages/HomePage.tsx");

  assert.doesNotMatch(home, /Admin.*Registration/i);
  assert.doesNotMatch(home, /\/admin\/face-registration/);
  assert.doesNotMatch(home, /Employee Management/);
  assert.doesNotMatch(home, /Employee Mode<\/button>/);
});

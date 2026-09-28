import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("the remote routes separate staff restock from admin employee workflows", async () => {
  const [app, staffPortal, adminPortal] = await Promise.all([
    source("src/App.tsx"),
    source("src/components/StaffPortal.tsx"),
    source("src/components/AdminPortal.tsx"),
  ]);

  assert.match(app, /STAFF_PORTAL_PATH = "\/staff"/);
  assert.match(app, /ADMIN_PORTAL_PATH = "\/admin"/);
  assert.match(app, /<StaffPortal/);
  assert.match(app, /<AdminPortal/);

  assert.match(staffPortal, /Staff Operations/);
  assert.match(staffPortal, /Start Restock/);
  assert.match(staffPortal, /cancelKioskSession/);
  assert.doesNotMatch(staffPortal, /Add Employee/);
  assert.doesNotMatch(staffPortal, /Employee directory/);
  assert.doesNotMatch(staffPortal, /Face Setup Required/);
  assert.doesNotMatch(staffPortal, /Start Face Registration/);
  assert.doesNotMatch(staffPortal, /startFaceRegistrationSession/);

  assert.match(adminPortal, /Admin \/ Employee Management/);
  assert.match(adminPortal, /id="admin-employee-name"/);
  assert.match(adminPortal, /fetchEmployeesForFaceRegistration/);
  assert.match(adminPortal, /createEmployee\(name/);
  assert.match(adminPortal, /Face Setup Required/);
  assert.match(adminPortal, /Start Face Registration/);
  assert.match(adminPortal, /cancelKioskSession/);
  assert.doesNotMatch(adminPortal, /Start Restock/);
  assert.doesNotMatch(adminPortal, /startRestockSession/);
  assert.doesNotMatch(adminPortal, /registerEmployeeFace/);
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
  assert.doesNotMatch(home, /href=["']\/staff/);
  assert.doesNotMatch(home, /href=["']\/admin/);
});

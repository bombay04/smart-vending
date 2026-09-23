import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("the staff portal is a dedicated cloud-only route", async () => {
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
  assert.doesNotMatch(portal, /api\/face-registration/);
  assert.doesNotMatch(portal, /registerEmployeeFace/);
  assert.doesNotMatch(portal, /Start Face/);
});

test("local face setup uses selection, local capture, and metadata-only sync recovery", async () => {
  const registration = await source("src/components/EmployeeFaceRegistration.tsx");

  assert.match(registration, /Select an employee/);
  assert.match(registration, /registerEmployeeFace\(selectedEmployee\.employeeCode/);
  assert.match(registration, /completeEmployeeFaceRegistration/);
  assert.match(registration, /setRegistrationStatuses/);
  assert.ok(
    registration.indexOf("await registerEmployeeFace") <
      registration.indexOf("await completeEmployeeFaceRegistration"),
  );
  assert.match(registration, /Face Setup Required/);
  assert.match(registration, /canRetryCapture/);
  assert.match(registration, /SYNC_ERROR/);
  assert.match(registration, /Retry Status Sync/);
  assert.doesNotMatch(registration, /type="text"/);
});

test("customer Home does not expose staff or admin registration navigation", async () => {
  const home = await source("src/pages/HomePage.tsx");

  assert.doesNotMatch(home, /Admin.*Registration/i);
  assert.doesNotMatch(home, /face-registration/);
  assert.doesNotMatch(home, /Employee Management/);
});

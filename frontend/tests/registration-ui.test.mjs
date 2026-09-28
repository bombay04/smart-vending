import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ADMIN_PORTAL_PATH,
  CUSTOMER_KIOSK_PATH,
  resolveAppPathname,
  STAFF_PORTAL_PATH,
} from "../src/app-route.mjs";

const source = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("routing exposes exactly the customer, staff, and admin surfaces", async () => {
  assert.equal(resolveAppPathname("/"), CUSTOMER_KIOSK_PATH);
  assert.equal(resolveAppPathname("/staff"), STAFF_PORTAL_PATH);
  assert.equal(resolveAppPathname("/admin"), ADMIN_PORTAL_PATH);
  for (const pathname of [
    "/admin/face-registration",
    "/staff/restock",
    "/unknown",
    "/admin/",
  ]) {
    assert.equal(resolveAppPathname(pathname), CUSTOMER_KIOSK_PATH);
  }

  const app = await source("src/App.tsx");
  assert.match(app, /resolveAppPathname\(window\.location\.pathname\)/);
  assert.match(app, /window\.history\.replaceState/);
  assert.match(app, /pathname === CUSTOMER_KIOSK_PATH/);
  assert.match(app, /pathname === STAFF_PORTAL_PATH/);
  assert.match(app, /pathname === ADMIN_PORTAL_PATH/);
  assert.doesNotMatch(app, /ADMIN_FACE_REGISTRATION_PATH/);
});

test("the remote portals separate staff restock from admin employee workflows", async () => {
  const [app, staffPortal, adminPortal] = await Promise.all([
    source("src/App.tsx"),
    source("src/components/StaffPortal.tsx"),
    source("src/components/AdminPortal.tsx"),
  ]);

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

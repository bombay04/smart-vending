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
  const [app, staffPortal, adminPortal, employeeApi] = await Promise.all([
    source("src/App.tsx"),
    source("src/components/StaffPortal.tsx"),
    source("src/components/AdminPortal.tsx"),
    source("src/api/employee-auth.ts"),
  ]);

  assert.match(app, /<StaffPortal/);
  assert.match(app, /<AdminPortal/);

  assert.match(staffPortal, /จัดการเติมสินค้า/);
  assert.match(staffPortal, /เริ่มเติมสินค้า/);
  assert.match(staffPortal, /cancelKioskSession/);
  assert.doesNotMatch(staffPortal, /เพิ่มพนักงาน/);
  assert.doesNotMatch(staffPortal, /รายชื่อพนักงาน/);
  assert.doesNotMatch(staffPortal, /ต้องลงทะเบียนใบหน้า/);
  assert.doesNotMatch(staffPortal, /เริ่มลงทะเบียนใบหน้า/);
  assert.doesNotMatch(staffPortal, /startFaceRegistrationSession/);

  assert.match(adminPortal, /<h1>ระบบจัดการพนักงาน<\/h1>/);
  assert.match(adminPortal, /<h2 id="add-employee-title">เพิ่มพนักงาน<\/h2>/);
  assert.match(adminPortal, />กรอกชื่อพนักงาน<\/label>/);
  assert.match(adminPortal, /\+ เพิ่มพนักงาน/);
  assert.match(adminPortal, /<h2 id="employee-list-title">รายชื่อพนักงาน<\/h2>/);
  assert.match(adminPortal, /id="admin-employee-name"/);
  assert.match(adminPortal, /fetchEmployeesForFaceRegistration/);
  assert.match(adminPortal, /createEmployee\(name/);
  assert.match(adminPortal, /ต้องลงทะเบียนใบหน้า/);
  assert.match(adminPortal, /เริ่มลงทะเบียนใบหน้า/);
  assert.match(adminPortal, />\s*แก้ไข\s*</);
  assert.match(adminPortal, /"ปิดใช้งาน"/);
  assert.match(adminPortal, /"เปิดใช้งาน"/);
  assert.match(adminPortal, />\s*นำออกจากระบบ\s*</);
  assert.match(adminPortal, />\s*ลบแบบร่าง\s*</);
  assert.doesNotMatch(adminPortal, />\s*Refresh\s*</);
  assert.match(adminPortal, /handleSaveName/);
  assert.match(adminPortal, /handleActiveChange/);
  assert.match(employeeApi, /method: "PATCH"/);
  assert.match(employeeApi, /startEmployeeDraftDelete/);
  assert.match(employeeApi, /offboardEmployee/);
  assert.match(adminPortal, /cancelKioskSession/);
  assert.doesNotMatch(adminPortal, /Start Restock/);
  assert.doesNotMatch(adminPortal, /startRestockSession/);
  assert.doesNotMatch(adminPortal, /registerEmployeeFace/);
});

test("admin draft deletion and offboarding are confirmed session workflows", async () => {
  const [adminPortal, employeeApi] = await Promise.all([
    source("src/components/AdminPortal.tsx"),
    source("src/api/employee-auth.ts"),
  ]);

  assert.doesNotMatch(
    adminPortal,
    /Delete Draft \{employee\.employeeCode\}\?/,
  );
  assert.doesNotMatch(
    adminPortal,
    /Permanently delete this unused employee after the[\s\S]*kiosk verifies/,
  );
  assert.match(adminPortal, /ยืนยันการลบแบบร่าง/);
  assert.match(adminPortal, /ยืนยันการนำออก/);
  assert.match(adminPortal, />\s*ยกเลิก\s*</);
  assert.doesNotMatch(adminPortal, /Offboard \{employee\.employeeCode\}\?/);
  assert.doesNotMatch(
    adminPortal,
    /Disable access and remove this employee(?:&apos;|')s face template/,
  );
  assert.doesNotMatch(adminPortal, /History is retained\./);
  assert.match(adminPortal, /setDeleteConfirmationId\(employee\.id\)/);
  assert.match(adminPortal, /startEmployeeDraftDelete\(employee\.id\)/);
  assert.match(adminPortal, /offboardEmployee\(employee\.id\)/);
  assert.match(adminPortal, /Waiting for kiosk biometric cleanup/);
  assert.match(adminPortal, /type: "CLEANUP_RESULT"/);
  assert.match(adminPortal, /tone: "WARNING"/);
  assert.match(adminPortal, /await loadEmployees\(\)/);
  assert.match(adminPortal, /rowErrors\[employee\.id\]/);
  assert.match(
    adminPortal,
    /error instanceof EmployeeManagementError \? error\.message/,
  );
  assert.match(employeeApi, /responseData\.error/);
  assert.match(
    employeeApi,
    /new EmployeeManagementError\(response\.status, message\)/,
  );
});

test("registered or used employees never receive the draft hard-delete control", async () => {
  const adminPortal = await source("src/components/AdminPortal.tsx");
  assert.match(adminPortal, /\{employee\.canDeleteDraft && \(/);
  assert.match(adminPortal, /ลบแบบร่าง/);
  assert.match(adminPortal, /employee\.activeCleanupType !== null/);
});

test("inactive employees are not offered face registration", async () => {
  const adminPortal = await source("src/components/AdminPortal.tsx");
  assert.match(
    adminPortal,
    /!employee\.faceRegistered &&[\s\S]*employee\.isActive &&[\s\S]*เริ่มลงทะเบียนใบหน้า/,
  );
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

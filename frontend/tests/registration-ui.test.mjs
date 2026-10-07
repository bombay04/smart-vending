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
    /new EmployeeManagementError\(response\.status, message, code\)/,
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
  const [registration, registrationApi] = await Promise.all([
    source("src/components/EmployeeFaceRegistration.tsx"),
    source("src/api/face-registration.ts"),
  ]);

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
  assert.match(registrationApi, /responseData\.code === "FACE_ALREADY_REGISTERED"/);
  assert.match(
    registrationApi,
    /throw new FaceRegistrationError\("FACE_ALREADY_REGISTERED"\)/,
  );
  assert.match(registration, /FACE_ALREADY_REGISTERED/);
  assert.match(registration, /ใบหน้านี้ถูกลงทะเบียนแล้ว/);
  assert.match(
    registration,
    /ใบหน้านี้ถูกใช้งานกับพนักงานคนอื่นในระบบแล้ว/,
  );
  const captureHandler = registration.match(
    /async function capture\(\)[\s\S]*?\r?\n  }\r?\n\r?\n  async function handleCancel/,
  )?.[0];
  assert.ok(captureHandler);
  assert.match(
    captureHandler,
    /await registerEmployeeFace[\s\S]*await syncCompletion/,
  );
  assert.match(
    captureHandler,
    /catch \(error: unknown\)[\s\S]*error instanceof FaceRegistrationError[\s\S]*setState/,
  );
  assert.match(registration, /ลองซิงค์สถานะอีกครั้ง/);
  assert.doesNotMatch(registration, /type="text"/);
});

test("Pi face registration reuses authentication icon colors for every state", async () => {
  const [registration, css] = await Promise.all([
    source("src/components/EmployeeFaceRegistration.tsx"),
    source("src/App.css"),
  ]);

  assert.match(registration, /className=\{`face-scan-indicator/);
  assert.match(registration, /state\.toLowerCase\(\)/);
  assert.match(
    css,
    /\.face-scan-indicator \{[\s\S]*?border: 3px solid #a5f3fc;[\s\S]*?color: #0e7490;[\s\S]*?background: #ecfeff;/,
  );
  assert.doesNotMatch(
    css,
    /\.employee-registration-card \.face-scan-indicator/,
  );
  assert.match(
    css,
    /\.face-scan-indicator--sync_error,[\s\S]*?\.face-scan-indicator--face_already_registered,[\s\S]*?\.face-scan-indicator--pi_unavailable \{[\s\S]*?border-color: #fecaca;[\s\S]*?color: #b91c1c;[\s\S]*?background: #fff7f7;/,
  );
  assert.match(registration, /<SuccessCheckIcon \/>/);
  assert.match(
    css,
    /\.face-scan-indicator--success \{[\s\S]*?border-color: transparent;[\s\S]*?background: transparent;/,
  );
  assert.match(
    css,
    /\.success-check-icon circle \{[\s\S]*?fill: #00c800;/,
  );
  assert.match(
    css,
    /\.success-check-icon path \{[\s\S]*?stroke: #ffffff;/,
  );
  assert.match(
    css,
    /\.face-scan-indicator--busy \{[\s\S]*?color: #a16207;[\s\S]*?background: #fffbeb;/,
  );
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

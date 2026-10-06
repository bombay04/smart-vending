import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("employee creation stays independent from kiosk state and uses an expiring modal", async () => {
  const admin = await source("src/components/AdminPortal.tsx");
  const createHandler = admin.match(
    /async function handleCreate[\s\S]*?\r?\n  }\r?\n\r?\n  function setEmployeeBusy/,
  )?.[0];

  assert.ok(createHandler);
  assert.match(createHandler, /createEmployee\(name\)/);
  assert.match(createHandler, /setEmployees/);
  assert.match(createHandler, /setName\(""\)/);
  assert.match(createHandler, /type: "EMPLOYEE_CREATED"/);
  assert.doesNotMatch(createHandler, /session|portalState|KIOSK_BUSY/);
  assert.match(admin, /const EMPLOYEE_CREATED_MODAL_MS = 3000/);
  assert.match(admin, /เพิ่มพนักงานสำเร็จ/);
  assert.doesNotMatch(admin, /เพิ่มข้อมูลพนักงานเรียบร้อยแล้ว/);
  assert.doesNotMatch(admin, /Created \$\{employee\.employeeCode\}/);
  assert.doesNotMatch(admin, /staff-message--success/);
});

test("busy kiosk feedback blocks only session creation and can close or retry", async () => {
  const [admin, kioskApi] = await Promise.all([
    source("src/components/AdminPortal.tsx"),
    source("src/api/kiosk-session.ts"),
  ]);

  assert.match(admin, /const KIOSK_BUSY_MODAL_MS = 5000/);
  assert.match(
    admin,
    /startFaceRegistrationSession\(employee\.id\)[\s\S]*KioskSessionRequestError[\s\S]*showTimedModal\(\{ type: "KIOSK_BUSY" \}/,
  );
  assert.match(admin, /error\.status === 409/);
  assert.match(admin, /Another staff session is already active for this kiosk/);
  assert.match(admin, /เครื่องกำลังถูกใช้งาน/);
  assert.match(admin, /ไม่สามารถเริ่มลงทะเบียนใบหน้าได้ในขณะนี้/);
  assert.doesNotMatch(
    admin,
    /กรุณารอให้ขั้นตอนปัจจุบันเสร็จสิ้นแล้วลองอีกครั้ง/,
  );
  assert.match(admin, /onClick=\{dismissTimedModal\}/);
  assert.match(admin, />\s*ตกลง\s*</);
  assert.match(kioskApi, /class KioskSessionRequestError extends Error/);
  assert.match(kioskApi, /response\.status/);
});

test("authoritative FACE_REGISTRATION state drives the accessible active modal", async () => {
  const [admin, css] = await Promise.all([
    source("src/components/AdminPortal.tsx"),
    source("src/App.css"),
  ]);

  assert.match(admin, /fetchCurrentKioskSession/);
  assert.match(admin, /setSession\(current\)/);
  assert.match(
    admin,
    /portalState === "OWN_SESSION" && session !== null && \(/,
  );
  assert.match(admin, /className="admin-face-registration-modal"/);
  assert.match(admin, /role="dialog"/);
  assert.match(admin, /aria-modal="true"/);
  assert.match(admin, />\s*กำลังลงทะเบียนใบหน้า\s*</);
  assert.doesNotMatch(admin, /กำลังลงทะเบียนใบหน้าพนักงาน/);
  assert.doesNotMatch(
    admin,
    /กรุณาดำเนินการลงทะเบียนที่หน้าจอเครื่องขายสินค้า/,
  );
  assert.match(admin, /หมดอายุใน \{secondsRemaining\} วินาที/);
  assert.match(admin, /handleCancelFaceRegistration/);
  assert.doesNotMatch(admin, /Face registration status/);
  assert.doesNotMatch(admin, /Face registration ACTIVE/);
  assert.match(css, /\.admin-modal-backdrop[\s\S]*position: fixed/);
  assert.match(css, /\.admin-face-registration-modal[\s\S]*width: min\(100%, 560px\)/);
  assert.match(
    css,
    /\.admin-face-registration-modal \.admin-face-registration-countdown \{[\s\S]*?color: #111827;/,
  );
});

test("active registration modal cannot be dismissed without cancelling its session", async () => {
  const admin = await source("src/components/AdminPortal.tsx");

  assert.doesNotMatch(admin, /hiddenFaceRegistrationSessionId/);
  assert.doesNotMatch(admin, /admin-face-registration-close/);
  assert.doesNotMatch(admin, />\s*ปิด\s*</);
  assert.match(admin, /"ยกเลิกการลงทะเบียน"/);
  assert.match(
    admin,
    /onClick=\{\(\) => void handleCancelFaceRegistration\(\)\}/,
  );
});

test("face registration start still delegates kiosk conflicts to the backend", async () => {
  const admin = await source("src/components/AdminPortal.tsx");
  const createHandler = admin.match(
    /async function handleCreate[\s\S]*?\r?\n  }\r?\n\r?\n  function setEmployeeBusy/,
  )?.[0];
  const startHandler = admin.match(
    /async function handleStartFaceRegistration[\s\S]*?\r?\n  }\r?\n\r?\n  async function handleCancelFaceRegistration/,
  )?.[0];

  assert.ok(createHandler);
  assert.ok(startHandler);
  assert.doesNotMatch(createHandler, /session/);
  assert.match(startHandler, /startFaceRegistrationSession\(employee\.id\)/);
  assert.doesNotMatch(startHandler, /if \(session !== null\)/);
  assert.match(startHandler, /error\.status === 409/);
  assert.match(startHandler, /type: "KIOSK_BUSY"/);
});

test("registration cancellation and polling still own session lifecycle", async () => {
  const admin = await source("src/components/AdminPortal.tsx");

  assert.match(
    admin,
    /async function handleCancelFaceRegistration[\s\S]*await cancelKioskSession\(session\.id\);[\s\S]*setSession\(null\)/,
  );
  assert.match(admin, /"ยกเลิกการลงทะเบียน"/);
  assert.match(admin, /const current = await fetchCurrentKioskSession/);
  assert.match(admin, /previousSessionRef\.current = current;[\s\S]*setSession\(current\)/);
});

test("directory headers and authoritative draft actions match lifecycle eligibility", async () => {
  const admin = await source("src/components/AdminPortal.tsx");

  assert.match(
    admin,
    /<span>รหัสพนักงาน<\/span>[\s\S]*<span>ชื่อ-นามสกุล<\/span>[\s\S]*<span>สถานะ<\/span>[\s\S]*<span>สถานะใบหน้า<\/span>[\s\S]*<span>การดำเนินการ<\/span>/,
  );
  assert.match(admin, /\{!employee\.canDeleteDraft && \(/);
  assert.match(admin, /\{employee\.canDeleteDraft && \(/);
  assert.match(admin, /employee\.isActive \? "ใช้งานอยู่" : "ปิดใช้งาน"/);
  assert.match(admin, /"ลงทะเบียนแล้ว"/);
  assert.match(admin, /"ต้องลงทะเบียนใบหน้า"/);
  assert.match(admin, />\s*แก้ไข\s*</);
  assert.match(admin, />\s*ลบแบบร่าง\s*</);
  assert.match(admin, />\s*เริ่มลงทะเบียนใบหน้า\s*</);
  assert.match(admin, /"ปิดใช้งาน"/);
  assert.match(admin, /"เปิดใช้งาน"/);
  assert.match(admin, />\s*นำออกจากระบบ\s*</);
  assert.doesNotMatch(admin, /faceStatus\s*===/);
});

test("draft cleanup runs in the background without showing an active inspection modal", async () => {
  const admin = await source("src/components/AdminPortal.tsx");

  assert.match(admin, /startEmployeeDraftDelete\(employee\.id\)/);
  assert.match(admin, /previous\?\.type === "EMPLOYEE_DRAFT_DELETE"/);
  assert.doesNotMatch(admin, /กำลังตรวจสอบข้อมูลพนักงาน/);
  assert.match(
    admin,
    /employee\.activeCleanupType === "EMPLOYEE_OFFBOARDING" && \([\s\S]*Waiting for kiosk biometric cleanup/,
  );
  assert.doesNotMatch(
    admin,
    /employee\.activeCleanupType !== null && \([\s\S]*Waiting for kiosk biometric cleanup/,
  );
  assert.doesNotMatch(admin, /className="admin-cleanup-modal"/);
});

test("draft completion uses timed result modals while polling remains authoritative", async () => {
  const admin = await source("src/components/AdminPortal.tsx");

  assert.match(admin, /const CLEANUP_SUCCESS_MODAL_MS = 3000/);
  assert.match(admin, /const CLEANUP_RESULT_MODAL_MS = 5000/);
  assert.match(admin, /type: "CLEANUP_RESULT"/);
  assert.match(admin, /tone: "SUCCESS"/);
  assert.match(admin, /tone: "WARNING"/);
  assert.match(admin, /previous\.type === "EMPLOYEE_DRAFT_DELETE"/);
  assert.match(admin, /await loadEmployees\(\)/);
  assert.match(admin, /ลบข้อมูลพนักงานสำเร็จ/);
  assert.doesNotMatch(admin, /นำพนักงานออกจากระบบสำเร็จ/);
  assert.doesNotMatch(admin, /กำลังนำพนักงานออกจากระบบ/);
  assert.doesNotMatch(admin, /lifecycleMessage/);
});

test("Pi face setup keeps Back enabled during capture and reuses the scan indicator", async () => {
  const [registration, home] = await Promise.all([
    source("src/components/EmployeeFaceRegistration.tsx"),
    source("src/pages/HomePage.tsx"),
  ]);

  assert.match(registration, /className=\{`face-scan-indicator/);
  assert.match(registration, /state === "CAPTURING" \? "scanning"/);
  assert.match(registration, />ลงทะเบียนใบหน้า<\/h1>/);
  assert.doesNotMatch(registration, /Authorized Staff Session/i);
  assert.doesNotMatch(registration, /Employee Face Setup/);
  assert.match(registration, /title: "กำลังตรวจสอบการลงทะเบียน"/);
  assert.doesNotMatch(registration, /พร้อมลงทะเบียน/);
  assert.doesNotMatch(
    registration,
    /Ask the named employee to face the camera alone, then start registration\./,
  );
  assert.match(registration, /READY: \{ instruction: "กรุณามองตรงไปที่กล้อง" \}/);
  assert.match(
    registration,
    /กรุณา \{employee\.employeeCode\} \{employee\.name\}/,
  );
  assert.doesNotMatch(
    registration,
    /\{employee\.name\} - \{employee\.employeeCode\}/,
  );
  assert.match(registration, /title: "กำลังบันทึกใบหน้า"/);
  assert.match(
    registration,
    /กรุณามองตรงไปที่กล้องและอยู่ในตำแหน่งเดิม ขณะระบบกำลังบันทึกใบหน้า/,
  );
  assert.match(
    registration,
    /พบข้อมูลใบหน้าที่บันทึกไว้แล้ว กรุณาซิงค์สถานะโดยไม่ต้องสแกนใหม่/,
  );
  assert.match(registration, /"ซิงค์สถานะการลงทะเบียน"/);
  assert.match(
    registration,
    /กรุณาจัดใบหน้าให้อยู่ในตำแหน่งที่กล้องมองเห็น ปรับแสงให้เหมาะสม แล้วลองอีกครั้ง/,
  );
  assert.match(registration, /"ลองสแกนอีกครั้ง"/);
  assert.match(registration, /title: "ลงทะเบียนสำเร็จ"/);
  assert.match(registration, /"เริ่มสแกนใบหน้า"/);
  assert.match(registration, /"กลับสู่หน้าหลัก"/);
  assert.doesNotMatch(
    registration,
    /A local template already exists\. Sync its status without capturing again\./,
  );
  assert.doesNotMatch(registration, /Sync Registration Status/);
  assert.doesNotMatch(
    registration,
    /Move into view, improve lighting, and try again\./,
  );
  assert.doesNotMatch(registration, /Try Capture Again/);
  assert.doesNotMatch(
    registration,
    /Keep one face centered while five stabilized captures are collected\./,
  );
  assert.match(registration, /activeRequestRef\.current\?\.abort\(\)/);
  assert.match(registration, /await onCancel\(\)/);
  assert.match(registration, /disabled=\{isCancelling\}/);
  assert.doesNotMatch(registration, /disabled=\{busy\}[\s\S]*กลับสู่หน้าหลัก/);
  assert.match(home, /cancelActiveFaceRegistrationSession/);
  assert.match(home, /cancelFaceRegistrationSessionAndCleanup/);
  assert.match(home, /onCancel=\{cancelActiveFaceRegistrationSession\}/);
  assert.match(home, /onSessionEnded=\{clearStaffWorkflowState\}/);
});

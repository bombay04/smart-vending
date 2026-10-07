import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("face authentication READY copy is Thai and has no redundant labels", async () => {
  const authentication = await source(
    "src/components/EmployeeAuthentication.tsx",
  );

  for (const copy of [
    "ยืนยันตัวตนพนักงาน",
    "กรุณามองตรงไปที่กล้อง",
    "สแกนใบหน้า",
    "กลับสู่หน้าหลัก",
  ]) {
    assert.ok(authentication.includes(copy), `missing Thai copy: ${copy}`);
  }
  for (const copy of [
    "EMPLOYEE MODE",
    "Employee Mode",
    "Ready to Scan",
    "Face Authentication",
    "Scan Face",
    "Back to Customer Mode",
  ]) {
    assert.equal(authentication.includes(copy), false, `found English copy: ${copy}`);
  }
  assert.match(
    authentication,
    /IDLE: \{\s*instruction: "กรุณามองตรงไปที่กล้อง",\s*\}/,
  );
});

test("face authentication translates scanning, errors, attempts, lockout, and success", async () => {
  const authentication = await source(
    "src/components/EmployeeAuthentication.tsx",
  );

  for (const copy of [
    "กำลังสแกนใบหน้า",
    "กรุณามองตรงไปที่กล้องและอยู่นิ่ง ขณะระบบกำลังสแกนใบหน้า",
    "กำลังสแกน...",
    "ไม่พบใบหน้า",
    "กรุณาจัดใบหน้าให้อยู่ในตำแหน่งที่กล้องมองเห็น แล้วลองอีกครั้ง",
    "ตรวจพบหลายใบหน้า",
    "กรุณาให้พนักงานอยู่หน้ากล้องเพียงคนเดียว",
    "กล้องกำลังถูกใช้งาน",
    "มีการใช้งานกล้องอยู่ กรุณาลองอีกครั้งในอีกสักครู่",
    "ไม่สามารถใช้งานเครื่องสแกนได้",
    "กรุณาตรวจสอบบริการสแกนใบหน้าบนเครื่อง แล้วลองอีกครั้ง",
    "ยืนยันตัวตนไม่สำเร็จ",
    "ไม่สามารถยืนยันตัวตนได้ กรุณาลองอีกครั้ง",
    "ระบบยืนยันตัวตนถูกล็อกชั่วคราว",
    "เหลืออีก {remainingAttempts} ครั้งก่อนระบบล็อกชั่วคราว",
    "ลองอีกครั้งใน {formatCountdown(lockoutSeconds)}",
    "ยืนยันตัวตนสำเร็จ",
    "ยืนยันตัวตนพนักงานเรียบร้อยแล้ว กำลังเข้าสู่โหมดเติมสินค้า...",
    "ยินดีต้อนรับ {authenticatedEmployee.name}",
    "ลองอีกครั้ง",
  ]) {
    assert.ok(authentication.includes(copy), `missing Thai copy: ${copy}`);
  }

  for (const copy of [
    "Scanning Face",
    "No Face Detected",
    "Face Not Recognized",
    "One Person at a Time",
    "Scanner Busy",
    "Scanner Unavailable",
    "Face Authentication Locked",
    "attempt remaining",
    "attempts remaining",
    "temporary lockout",
    "Authentication Successful",
    "Employee identity verified",
    "Welcome,",
    "Try Again",
    "Checking...",
    "Temporarily Locked",
    "Closing Restock Session...",
  ]) {
    assert.equal(authentication.includes(copy), false, `found English copy: ${copy}`);
  }
});

test("authentication and registration share face state and success visuals", async () => {
  const [authentication, registration, admin, successIcon, css] =
    await Promise.all([
      source("src/components/EmployeeAuthentication.tsx"),
      source("src/components/EmployeeFaceRegistration.tsx"),
      source("src/components/AdminPortal.tsx"),
      source("src/components/SuccessCheckIcon.tsx"),
      source("src/App.css"),
    ]);

  for (const component of [authentication, registration]) {
    assert.match(component, /className=\{`face-scan-indicator/);
    assert.match(component, /<SuccessCheckIcon \/>/);
    assert.match(component, /face-flow-status--\$\{statusTone\}/);
  }
  assert.match(admin, /import SuccessCheckIcon from "\.\/SuccessCheckIcon"/);
  assert.match(admin, /<SuccessCheckIcon \/>/);
  assert.match(successIcon, /className="success-check-icon"/);
  assert.match(successIcon, /<circle cx="32" cy="32" r="32" \/>/);
  assert.match(successIcon, /<path d="M15 32\.5 26 44l23-25" \/>/);

  assert.match(
    css,
    /\.face-scan-indicator \{[\s\S]*?border: 3px solid #a5f3fc;[\s\S]*?color: #0e7490;[\s\S]*?background: #ecfeff;/,
  );
  assert.match(
    css,
    /\.face-scan-indicator--success \{[\s\S]*?border-color: transparent;[\s\S]*?background: transparent;/,
  );
  assert.match(
    css,
    /\.success-check-icon circle \{[\s\S]*?fill: #00c800;[\s\S]*?stroke: none;/,
  );
  assert.match(
    css,
    /\.success-check-icon path \{[\s\S]*?stroke: #ffffff;/,
  );
  assert.match(
    css,
    /\.face-scan-indicator--no_match,[\s\S]*?\.face-scan-indicator--pi_unavailable \{[\s\S]*?border-color: #fecaca;[\s\S]*?color: #b91c1c;[\s\S]*?background: #fff7f7;/,
  );
  assert.match(
    css,
    /\.face-flow-status--error h2 \{[\s\S]*?color: #b91c1c;/,
  );
  assert.match(
    css,
    /\.face-scan-indicator--busy \{[\s\S]*?color: #a16207;[\s\S]*?background: #fffbeb;/,
  );
});

test("normal face-session countdown stays blue while lockout remains red", async () => {
  const css = await source("src/App.css");

  assert.match(
    css,
    /\.admin-face-registration-modal \.admin-face-registration-countdown \{[\s\S]*?color: #1d4ed8;/,
  );
  assert.match(
    css,
    /\.employee-auth-status \.employee-auth-countdown \{[\s\S]*?color: #991b1b;/,
  );
});

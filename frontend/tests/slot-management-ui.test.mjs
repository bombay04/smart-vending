import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("admin keeps employee management and adds slot navigation", async () => {
  const admin = await source("src/components/AdminPortal.tsx");
  assert.match(admin, /จัดการพนักงาน/);
  assert.match(admin, /จัดการช่องสินค้า/);
  assert.match(admin, /activeSection === "employees"/);
  assert.match(admin, /<SlotManagement \/>/);
  assert.match(admin, /fetchEmployeesForFaceRegistration/);
  assert.match(admin, /startFaceRegistrationSession/);
  assert.match(admin, /offboardEmployee/);
});

test("slot management renders backend slots and supports validated save feedback", async () => {
  const [management, api] = await Promise.all([
    source("src/components/SlotManagement.tsx"),
    source("src/api/admin-slot.ts"),
  ]);
  assert.match(management, /fetchAdminSlots/);
  assert.match(management, /slots\.map\(\(slot\)/);
  assert.match(api, /slots\.length !== 3/);
  assert.match(api, /slot\.slotNumber !== index \+ 1/);
  assert.match(management, /ชื่อสินค้า/);
  assert.match(management, /ราคาขาย \(บาท\)/);
  assert.match(management, /URL รูปภาพ \(ไม่บังคับ\)/);
  assert.match(management, /เปิดจำหน่ายสินค้า/);
  assert.match(management, /URL รูปภาพต้องเป็น HTTPS/);
  assert.match(management, /SLOT_PAYMENT_ACTIVE/);
  assert.match(management, /บันทึกไม่สำเร็จ/);
  assert.doesNotMatch(management, /status:\s*"AVAILABLE"/);
});

test("product images fall back to the first letter after empty or failed loads", async () => {
  const [media, home] = await Promise.all([
    source("src/components/ProductMedia.tsx"),
    source("src/pages/HomePage.tsx"),
  ]);
  assert.match(media, /name\.trim\(\)\.charAt\(0\)/);
  assert.match(media, /onError=\{\(\) => setImageFailed\(true\)\}/);
  assert.match(media, /imageUrl && !imageFailed/);
  assert.match(home, /<ProductMedia/);
});

test("kiosk polls slots only while safely idle and disables inactive products", async () => {
  const home = await source("src/pages/HomePage.tsx");
  assert.match(home, /SLOT_REFRESH_INTERVAL_MS = 7000/);
  assert.match(home, /activeMode === "customer"/);
  assert.match(home, /recoveryState === "idle"/);
  assert.match(home, /paymentScreen === null/);
  assert.match(home, /purchaseSuccess === null/);
  assert.match(home, /if \(!isSafeCustomerIdle\) return undefined/);
  assert.match(home, /fetchSlots\(controller\.signal\)/);
  assert.match(home, /slot\.product\.isActive/);
});

test("staff portal implementation remains independent of slot management", async () => {
  const staff = await source("src/components/StaffPortal.tsx");
  assert.match(staff, /จัดการเติมสินค้า/);
  assert.doesNotMatch(staff, /SlotManagement|admin\/slots/);
});

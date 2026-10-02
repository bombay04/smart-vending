import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("staff portal renders the Thai primary interface", async () => {
  const staffPortal = await source("src/components/StaffPortal.tsx");

  assert.match(staffPortal, /จัดการเติมสินค้า/);
  assert.doesNotMatch(
    staffPortal,
    /เริ่มและติดตามการเติมสินค้าที่เครื่องขายสินค้า/,
  );
  assert.match(staffPortal, /สถานะการเติมสินค้า/);
  assert.match(staffPortal, /เครื่องจะตรวจสอบพนักงานก่อนเข้าสู่โหมดเติมสินค้า/);
  assert.match(staffPortal, /เริ่มเติมสินค้า/);
  assert.doesNotMatch(staffPortal, /Back to Home/);
});

test("active restock authentication is represented by an accessible modal", async () => {
  const [staffPortal, css] = await Promise.all([
    source("src/components/StaffPortal.tsx"),
    source("src/App.css"),
  ]);

  assert.match(
    staffPortal,
    /portalState === "OWN_SESSION" && session !== null && \(/,
  );
  assert.match(staffPortal, /className="staff-restock-modal-backdrop"/);
  assert.match(staffPortal, /role="dialog"/);
  assert.match(staffPortal, /aria-modal="true"/);
  assert.match(staffPortal, /กำลังรอยืนยันตัวตนพนักงาน/);
  assert.match(staffPortal, /กรุณาสแกนใบหน้าที่หน้าจอเครื่องขายสินค้า/);
  assert.match(staffPortal, /หมดอายุใน \{secondsRemaining\} วินาที/);
  assert.match(staffPortal, /"กำลังยกเลิก\.\.\." : "ยกเลิก"/);
  assert.match(css, /\.staff-restock-modal-backdrop[\s\S]*position: fixed/);
  assert.match(css, /\.staff-restock-modal[\s\S]*width: min\(100%, 560px\)/);
  assert.match(css, /max-height: calc\(100dvh - 32px\)/);
});

test("modal uses authoritative session state and keeps cancel wiring intact", async () => {
  const staffPortal = await source("src/components/StaffPortal.tsx");

  assert.match(staffPortal, /const portalState = getPortalSessionState\(session/);
  assert.match(staffPortal, /setSession\(current\)/);
  assert.match(staffPortal, /await cancelKioskSession\(session\.id\)/);
  assert.match(staffPortal, /setSession\(null\)/);
  assert.match(staffPortal, /onClick=\{\(\) => void handleCancelRestock\(\)\}/);
  assert.doesNotMatch(staffPortal, /Restock authentication ACTIVE/);
  assert.doesNotMatch(
    staffPortal,
    /The kiosk is waiting for employee face authentication\./,
  );
});

test("staff feedback expires and is cleared before a new restock session", async () => {
  const staffPortal = await source("src/components/StaffPortal.tsx");

  assert.match(
    staffPortal,
    /if \(message === null\) return;[\s\S]*window\.setTimeout\(\(\) => setMessage\(null\), 2500\)/,
  );
  assert.match(
    staffPortal,
    /async function handleStartRestock\(\)[\s\S]*setMessage\(null\);[\s\S]*startRestockSession\(\)/,
  );
  assert.match(staffPortal, /ยกเลิกการเติมสินค้าแล้ว/);
});

test("Thai typography is local and mobile modal content remains accessible", async () => {
  const css = await source("src/App.css");

  assert.match(
    css,
    /\.staff-portal-page[\s\S]*"Leelawadee UI", Tahoma, "Noto Sans Thai", sans-serif/,
  );
  assert.doesNotMatch(css, /fonts\.googleapis\.com/);
  assert.match(
    css,
    /@media \(max-width: 620px\)[\s\S]*\.staff-restock-modal[\s\S]*max-height: calc\(100dvh - 32px\)/,
  );
  assert.match(css, /\.staff-restock-cancel[\s\S]*width: 100%/);
});

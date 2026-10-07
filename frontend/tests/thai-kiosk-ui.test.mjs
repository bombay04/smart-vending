import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("product selection uses Thai presentation copy and a centered minimal header", async () => {
  const [home, productDisplay, css] = await Promise.all([
    source("src/pages/HomePage.tsx"),
    source("src/product-display.ts"),
    source("src/App.css"),
  ]);

  for (const copy of [
    "ช่อง {slot.slotNumber}",
    "พร้อมจำหน่าย",
    "สินค้าหมด",
    '"ซื้อ"',
    "บาท",
  ]) {
    assert.ok(home.includes(copy), `missing customer copy: ${copy}`);
  }
  for (const productName of ["กระดาษทิชชู", "ผ้าอนามัย", "ทิชชูเปียก"]) {
    assert.ok(productDisplay.includes(productName), `missing product mapping: ${productName}`);
  }
  for (const removedCopy of [
    "Customer Mode",
    "Please select a product",
    '"Sold Out"',
    '"Buy"',
    ">THB<",
  ]) {
    assert.equal(home.includes(removedCopy), false, `found removed copy: ${removedCopy}`);
  }
  assert.match(home, /className="page-header customer-page-header"/);
  assert.match(home, /<h1>Smart Vending Machine<\/h1>/);
  assert.match(
    css,
    /\.customer-page-header \{[\s\S]*?text-align: center;/,
  );
  assert.match(css, /\.product-price span \{[\s\S]*?font-size: 1em;/);
  assert.match(productDisplay, /THAI_PRODUCT_NAMES\[productName\] \?\? productName/);
});

test("restock screen uses Thai status copy, guidance, and compact employee identity", async () => {
  const restock = await source("src/components/RestockMode.tsx");

  for (const copy of [
    "เติมสินค้า",
    "ออกจากโหมดเติมสินค้า",
    "ช่อง {slot.slotNumber}",
    "สินค้า",
    "ฝาตู้",
    "พร้อม",
    "ยังไม่พร้อม",
    "มีสินค้า",
    "ไม่มีสินค้า",
    "ปิด",
    "เปิด",
    "ยืนยันการเติมสินค้า",
    "ตรวจสอบว่าสินค้าครบทุกช่องและฝาตู้ปิดสนิทแล้ว",
    "กรุณาตรวจสอบสินค้าในทุกช่องและปิดฝาตู้ให้สนิทก่อนยืนยันการเติมสินค้า",
  ]) {
    assert.ok(restock.includes(copy), `missing restock copy: ${copy}`);
  }
  for (const removedCopy of [
    "Employee Mode",
    "Restock Mode",
    "Signed in as",
    "Current physical slot and door status",
    "All slots ready for restock confirmation",
    "All slots must be READY before restock can be confirmed.",
    "Confirm Restock",
    "Inventory has been restored.",
  ]) {
    assert.equal(restock.includes(removedCopy), false, `found removed copy: ${removedCopy}`);
  }
  assert.match(
    restock,
    /\{authenticatedEmployee\.name\} · \{authenticatedEmployee\.employeeCode\}/,
  );
});

test("payment and customer completion states use Thai copy and the shared success icon", async () => {
  const home = await source("src/pages/HomePage.tsx");

  for (const copy of [
    "สแกน QR เพื่อชำระเงิน",
    "กำลังรอยืนยันการชำระเงิน...",
    "กรุณาชำระเงินก่อน",
    "บาท",
    "ชำระเงินสำเร็จ",
    "กำลังปลดล็อกช่อง {payment.slotNumber}",
    "ขอบคุณค่ะ",
    "กรุณารับสินค้า",
  ]) {
    assert.ok(home.includes(copy), `missing payment copy: ${copy}`);
  }
  for (const removedCopy of [
    ">PromptPay<",
    "Scan to pay",
    "Waiting for payment confirmation",
    "Payment successful",
    "Thank You",
    "Please take your product.",
    "Returning to product selection",
  ]) {
    assert.equal(home.includes(removedCopy), false, `found removed copy: ${removedCopy}`);
  }
  assert.match(home, /import SuccessCheckIcon from "\.\.\/components\/SuccessCheckIcon"/);
  assert.match(home, /<SuccessCheckIcon \/>/);
  assert.doesNotMatch(home, /purchase-success__icon/);
});

test("restock completion uses Thai copy and the same shared success icon", async () => {
  const restock = await source("src/components/RestockMode.tsx");

  assert.match(restock, /<h1>เติมสินค้าสำเร็จ<\/h1>/);
  assert.match(restock, /กำลังกลับสู่หน้าขายสินค้า\.\.\./);
  assert.match(restock, /import SuccessCheckIcon from "\.\/SuccessCheckIcon"/);
  assert.match(restock, /<SuccessCheckIcon \/>/);
  assert.doesNotMatch(restock, /purchase-success__icon|\\u2713/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("per-slot unlock controls render only inside face-authenticated restock mode", async () => {
  const [home, restock] = await Promise.all([
    source("src/pages/HomePage.tsx"),
    source("src/components/RestockMode.tsx"),
  ]);
  assert.match(
    home,
    /activeMode === "restock"[\s\S]*authenticatedEmployee !== null[\s\S]*restockFaceAuthorization !== null/,
  );
  assert.match(restock, /inventorySlots\.find/);
  assert.match(restock, /`เปิดช่อง \$\{slot\.slotNumber\}`/);
  assert.match(
    restock,
    /unlockRestockSlot\([\s\S]*sessionId[\s\S]*slotNumber[\s\S]*faceAuthorization/,
  );
});

test("a slot remains disabled until its observed closed-open-closed cycle completes", async () => {
  const restock = await source("src/components/RestockMode.tsx");
  assert.match(restock, /unlockCyclesRef\.current\.has\(slotNumber\)/);
  assert.match(restock, /beginRestockUnlock\([\s\S]*slotNumber/);
  assert.match(restock, /applyRestockDoorObservations/);
  assert.match(restock, /unlockCycle !== undefined/);
  assert.match(restock, /!doorIsClosed/);
  assert.match(restock, /role="status"/);
});

test("sensor errors show an unavailable state instead of unlock controls", async () => {
  const restock = await source("src/components/RestockMode.tsx");
  assert.match(restock, /isUnavailable && \(/);
  assert.match(restock, /slots !== null && !isUnavailable/);
  assert.match(restock, /hardware-unavailable/);
});

test("maintenance unlock gets a cloud grant then calls only the localhost Pi path", async () => {
  const [unlockApi, paymentFlow] = await Promise.all([
    source("src/api/unlock.ts"),
    source("src/payment-flow.mjs"),
  ]);
  assert.match(unlockApi, /\/api\/v1\/restocks\/unlock-grant/);
  assert.match(unlockApi, /PI_UNLOCK_BASE_URL}\/restock\/unlock/);
  assert.match(
    unlockApi,
    /JSON\.stringify\(\{ sessionId, slotNumber, faceAuthorization \}\)/,
  );
  assert.match(unlockApi, /JSON\.stringify\(\{ slotNumber, authorization \}\)/);
  assert.ok(
    unlockApi.indexOf("await fetch(restockGrantUrl") <
      unlockApi.indexOf("await fetch(restockUnlockUrl"),
  );
  assert.match(
    unlockApi,
    /ไม่สามารถยืนยันสิทธิ์เปิดช่องได้ กรุณาตรวจสอบการเชื่อมต่อ/,
  );
  assert.match(unlockApi, /ไม่สามารถอ่านสถานะฝาตู้ได้ กรุณาติดต่อผู้ดูแล/);
  assert.match(
    paymentFlow,
    /unlock\(payment\.slotNumber, payment\.transactionId\)/,
  );
});

test("restock confirmation still requires IR presence and stable closed Reed status", async () => {
  const restock = await source("src/components/RestockMode.tsx");
  assert.match(restock, /if \(!slot\.doorClosed\)/);
  assert.match(restock, /if \(!slot\.productPresent\)/);
  assert.match(restock, /STABLE_CLOSED_DURATION_MS/);
  assert.match(
    restock,
    /slots\.every\(\(slot\) => slot\.validationState === "READY"\)/,
  );
});

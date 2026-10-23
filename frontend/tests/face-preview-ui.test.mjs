import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("authentication and enrollment render the Pi-owned live preview only while scanning", async () => {
  const [authentication, registration] = await Promise.all([
    source("src/components/EmployeeAuthentication.tsx"),
    source("src/components/EmployeeFaceRegistration.tsx"),
  ]);

  assert.match(authentication, /isScanning && activeScanId !== null/);
  assert.match(registration, /state === "CAPTURING" && activeScanId !== null/);
  for (const component of [authentication, registration]) {
    assert.match(component, /<FaceScanPreview scanId=\{activeScanId\}/);
    assert.match(component, /createFaceScanId\(\)/);
    assert.match(component, /cancelFaceScan\(activeScanIdRef\.current\)/);
  }
});

test("preview polls ephemeral localhost state and never requests browser camera access", async () => {
  const [preview, scanApi] = await Promise.all([
    source("src/components/FaceScanPreview.tsx"),
    source("src/api/face-scan.ts"),
  ]);

  assert.match(scanApi, /PI_UNLOCK_BASE_URL.*\/face\/scan\/preview/s);
  assert.match(scanApi, /\/face\/scan\/status/);
  assert.match(scanApi, /\/face\/scan\/cancel/);
  assert.match(preview, /window\.clearInterval\(statusTimer\)/);
  assert.match(preview, /controller\.abort\(\)/);
  assert.doesNotMatch(`${preview}\n${scanApi}`, /getUserMedia|mediaDevices/);
});

test("both Pi scan operations send a unique scan id with the protected request", async () => {
  const [authApi, registrationApi] = await Promise.all([
    source("src/api/face-auth.ts"),
    source("src/api/face-registration.ts"),
  ]);

  assert.match(authApi, /JSON\.stringify\(\{ sessionId, scanId \}\)/);
  assert.match(
    registrationApi,
    /JSON\.stringify\(\{ employeeCode: normalizedEmployeeCode, scanId \}\)/,
  );
});

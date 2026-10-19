import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const frontendSource = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");
const backendSource = (path) =>
  readFile(new URL(`../../backend/${path}`, import.meta.url), "utf8");

test("cloud portal API calls default to same-origin while Pi hardware stays local", async () => {
  const apiConfig = await frontendSource("src/config/api.ts");

  assert.match(
    apiConfig,
    /import\.meta\.env\.VITE_API_BASE_URL\?\.trim\(\) \|\| ""/,
  );
  assert.doesNotMatch(apiConfig, /VITE_API_BASE_URL[^\n]*localhost:3000/);
  assert.match(apiConfig, /VITE_PI_UNLOCK_BASE_URL[\s\S]*http:\/\/localhost:5000/);
});

test("Express serves only the reviewed portal SPA routes after API routes", async () => {
  const app = await backendSource("src/app.ts");
  const apiRouteIndex = app.indexOf('app.use("/api/v1/admin/slots"');
  const staticIndex = app.indexOf("app.use(express.static(frontendDistDirectory");
  const errorMiddlewareIndex = app.indexOf("app.use(errorMiddleware)");

  assert.ok(apiRouteIndex >= 0);
  assert.ok(staticIndex > apiRouteIndex);
  assert.ok(errorMiddlewareIndex > staticIndex);
  assert.match(
    app,
    /path\.resolve\(__dirname, "\.\.\/\.\.\/frontend\/dist"\)/,
  );
  assert.match(app, /app\.get\(\["\/staff", "\/admin"\]/);
  assert.doesNotMatch(app, /app\.get\([^\n]*"\/"/);
});

test("portal session creation and Pi polling continue to share the kiosk-session API", async () => {
  const [sessions, staff, kiosk] = await Promise.all([
    frontendSource("src/api/kiosk-session.ts"),
    frontendSource("src/components/StaffPortal.tsx"),
    frontendSource("src/pages/HomePage.tsx"),
  ]);

  assert.match(sessions, /const sessionsUrl = `\$\{API_BASE_URL\}\/api\/v1\/kiosk-sessions`/);
  assert.match(sessions, /fetch\(`\$\{sessionsUrl\}\/restock`/);
  assert.match(sessions, /fetch\(`\$\{sessionsUrl\}\/current`/);
  assert.match(staff, /startRestockSession\(\)/);
  assert.match(kiosk, /fetchCurrentKioskSession/);
});

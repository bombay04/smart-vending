import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const frontendSource = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");
const repositorySource = (path) =>
  readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("Pi launcher uses configurable kiosk mode without browser recovery chrome", async () => {
  const [launcher, desktop, exampleConfig] = await Promise.all([
    repositorySource("edge/kiosk/launch-chromium-kiosk.sh"),
    repositorySource("edge/kiosk/smart-vending-kiosk.desktop"),
    repositorySource("edge/kiosk/kiosk.env.example"),
  ]);

  assert.match(launcher, /KIOSK_URL:-http:\/\/localhost:5173/);
  assert.match(launcher, /--kiosk/);
  assert.match(launcher, /--app="\$kiosk_url"/);
  assert.match(launcher, /--disable-session-crashed-bubble/);
  assert.match(launcher, /--noerrdialogs/);
  assert.match(launcher, /readiness_asset_url=.*\/src\/main\.tsx/);
  assert.match(launcher, /consecutive_ready == 2/);
  assert.match(launcher, /chromium_running\(\)/);
  assert.match(launcher, /KIOSK_READY_MAX_ATTEMPTS/);
  assert.match(launcher, /sleep "\$readiness_retry_seconds"/);
  assert.match(desktop, /X-GNOME-Autostart-enabled=true/);
  assert.match(desktop, /smart-vending-kiosk/);
  assert.match(exampleConfig, /KIOSK_URL=http:\/\/localhost:5173/);
  assert.match(exampleConfig, /KIOSK_READY_RETRY_SECONDS=2/);
});

test("Pi systemd units supervise independent local services", async () => {
  const [frontendUnit, piUnit, piEnvironment] = await Promise.all([
    repositorySource("deploy/systemd/smart-vending-frontend.service"),
    repositorySource("deploy/systemd/smart-vending-pi-unlock.service"),
    repositorySource("deploy/systemd/pi-unlock-service.env.example"),
  ]);

  assert.match(frontendUnit, /^User=user$/m);
  assert.match(
    frontendUnit,
    /^WorkingDirectory=\/home\/user\/smart-vending\/frontend$/m,
  );
  assert.match(
    frontendUnit,
    /^ExecStart=\/usr\/bin\/npm run dev -- --host 0\.0\.0\.0$/m,
  );
  assert.match(frontendUnit, /^Restart=on-failure$/m);

  assert.match(piUnit, /^User=user$/m);
  assert.match(piUnit, /^WorkingDirectory=\/home\/user\/smart-vending$/m);
  assert.match(
    piUnit,
    /^EnvironmentFile=\/home\/user\/\.config\/smart-vending\/pi-unlock-service\.env$/m,
  );
  assert.match(
    piUnit,
    /^ExecStart=\/home\/user\/smart-vending\/\.venv\/bin\/python edge\/pi_unlock_service\.py$/m,
  );
  assert.match(piUnit, /^Restart=on-failure$/m);
  assert.doesNotMatch(frontendUnit, /smart-vending-pi-unlock/);
  assert.doesNotMatch(piUnit, /smart-vending-frontend/);

  assert.match(
    piEnvironment,
    /^ESP32_SERIAL_PORT=\/dev\/serial\/by-id\/REPLACE_WITH_VERIFIED_DEVICE_ID$/m,
  );
  assert.match(
    piEnvironment,
    /^AUDIO_ALSA_DEVICE=plughw:CARD=UACDemoV10,DEV=0$/m,
  );
  assert.match(piEnvironment, /^FACE_CAMERA_INDEX=0$/m);
  assert.match(piEnvironment, /^FACE_CAMERA_USB_RECOVERY_ENABLED=true$/m);
});

test("touch hardening preserves selection for editable controls", async () => {
  const [app, indexCss] = await Promise.all([
    frontendSource("src/App.tsx"),
    frontendSource("src/index.css"),
  ]);

  assert.match(app, /addEventListener\("contextmenu"/);
  assert.match(app, /closest\("input, textarea, \[contenteditable='true'\]"\)/);
  assert.match(indexCss, /#root[\s\S]*user-select: none/);
  assert.match(indexCss, /\[contenteditable="true"\][\s\S]*user-select: text/);
  assert.match(indexCss, /img[\s\S]*-webkit-user-drag: none/);
  assert.match(indexCss, /overscroll-behavior: none/);
});

test("short landscape layout covers each Pi-facing surface", async () => {
  const [appCss, homePage] = await Promise.all([
    frontendSource("src/App.css"),
    frontendSource("src/pages/HomePage.tsx"),
  ]);

  assert.match(appCss, /@media \(min-width: 901px\) and \(max-height: 700px\)/);
  assert.match(appCss, /\.home-page:not\(\.remote-portal-page\)/);
  assert.match(
    homePage,
    /className="home-page customer-kiosk-page customer-selection-page"/,
  );
  for (const selector of [
    ".slot-grid",
    ".payment-card",
    ".purchase-success",
    ".employee-auth-card",
    ".hardware-grid",
    ".restock-confirmation",
    ".employee-registration-card",
  ]) {
    assert.ok(appCss.lastIndexOf(selector) > appCss.indexOf("max-height: 700px"));
  }
});

test("Pi product selection follows the 1024x600 reference dimensions", async () => {
  const appCss = await frontendSource("src/App.css");
  const piLayout = appCss.slice(appCss.indexOf("max-height: 700px"));

  assert.match(piLayout, /\.home-page\.customer-selection-page\s*{[\s\S]*?padding: 18px 32px;[\s\S]*?background: #0b0b0b;/);
  assert.match(piLayout, /\.customer-selection-page \.page-header\.customer-page-header h1\s*{[\s\S]*?font-size: 30px;/);
  assert.match(piLayout, /\.customer-selection-page \.slot-grid\s*{[\s\S]*?grid-template-columns: repeat\(3, minmax\(310px, 320px\)\);/);
  assert.match(piLayout, /\.customer-selection-page \.product-media,[\s\S]*?width: 160px;[\s\S]*?height: 170px;/);
  assert.match(piLayout, /\.customer-selection-page \.product-name\s*{[\s\S]*?font-size: 24px;/);
  assert.match(piLayout, /\.customer-selection-page \.product-price\s*{[\s\S]*?font-size: 32px;/);
  assert.match(piLayout, /\.customer-selection-page \.buy-button\s*{[\s\S]*?min-height: 60px;/);
  assert.match(piLayout, /\.customer-selection-page \.status-badge\s*{[\s\S]*?display: none;/);
});

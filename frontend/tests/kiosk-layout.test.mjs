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
  assert.match(launcher, /until curl .*"\$kiosk_url"; do/);
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

  assert.match(piEnvironment, /^ESP32_SERIAL_PORT=\/dev\/ttyUSB0$/m);
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
  const appCss = await frontendSource("src/App.css");

  assert.match(appCss, /@media \(min-width: 901px\) and \(max-height: 700px\)/);
  assert.match(appCss, /\.home-page:not\(\.remote-portal-page\)/);
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

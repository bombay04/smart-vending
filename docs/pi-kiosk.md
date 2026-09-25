# Raspberry Pi Chromium Kiosk

The repository includes a small Chromium launcher for the 1024x600 cabinet touchscreen. It opens only the configured application URL in fullscreen kiosk/app mode, uses an isolated browser profile, and suppresses first-run, error, and crashed-session UI. It does not start or supervise the frontend, backend, or Pi hardware service.

## One-time Raspberry Pi setup

Run these commands from the repository root while signed in as the Linux user whose graphical desktop starts automatically:

```bash
sudo apt update
sudo apt install chromium

mkdir -p "$HOME/.local/bin" "$HOME/.config/autostart"
install -m 0755 edge/kiosk/launch-chromium-kiosk.sh "$HOME/.local/bin/smart-vending-kiosk"
install -m 0644 edge/kiosk/smart-vending-kiosk.desktop "$HOME/.config/autostart/smart-vending-kiosk.desktop"
install -m 0644 edge/kiosk/kiosk.env.example "$HOME/.config/smart-vending-kiosk.env"
```

Older Raspberry Pi OS releases may name the package `chromium-browser`; the launcher detects either executable.

Edit the user-owned configuration if the frontend is not served from the default local Vite URL:

```bash
nano "$HOME/.config/smart-vending-kiosk.env"
```

```ini
KIOSK_URL=http://localhost:5173
```

Prefer `localhost` when the frontend runs on the same Pi. If the frontend is hosted elsewhere, set its stable hostname or deployment URL rather than a developer PC address. `CHROMIUM_BIN=/path/to/chromium` is also supported when automatic detection is insufficient.

Ensure the frontend is already started by the existing deployment setup before the desktop session begins. Test the launcher once from a terminal:

```bash
"$HOME/.local/bin/smart-vending-kiosk"
```

Then log out and back in, or reboot. The XDG autostart entry launches Chromium only after the graphical session starts.

There is intentionally no customer-facing kiosk exit control. Perform maintenance over SSH or with a locally attached keyboard/Linux console. To disable autostart during maintenance, rename or remove `$HOME/.config/autostart/smart-vending-kiosk.desktop`, then restore it when finished.

## Updating the launcher

After pulling a reviewed launcher change, reinstall only the repository-owned files:

```bash
install -m 0755 edge/kiosk/launch-chromium-kiosk.sh "$HOME/.local/bin/smart-vending-kiosk"
install -m 0644 edge/kiosk/smart-vending-kiosk.desktop "$HOME/.config/autostart/smart-vending-kiosk.desktop"
```

The local `smart-vending-kiosk.env` file is not overwritten by this update.

# Raspberry Pi Chromium Kiosk

The repository includes a small Chromium launcher for the 1024x600 cabinet touchscreen. It opens only the configured application URL in fullscreen kiosk/app mode, uses an isolated browser profile, and suppresses first-run, error, and crashed-session UI. It does not start or supervise the frontend, backend, or Pi hardware service.

## One-time Raspberry Pi setup

Run these commands from the repository root while signed in as the Linux user whose graphical desktop starts automatically:

```bash
sudo apt update
sudo apt install chromium curl procps

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

At cold start, the launcher checks `KIOSK_URL` twice successfully on separate polls before starting Chromium. For the local Vite URL on port 5173, each poll also checks `/src/main.tsx`, the application's entry module. It retries every two seconds for at most 30 polls by default and logs each result; after the limit it exits without opening Chromium. The HTTP probes each have a two-second timeout. Set `KIOSK_READY_RETRY_SECONDS` or `KIOSK_READY_MAX_ATTEMPTS` in the local configuration if boot timing requires it (`MAX_ATTEMPTS` must be at least 2). The launcher checks for an existing Chromium process before waiting and again before launch; it leaves that browser and its active payment session untouched.

This narrows a possible cold-boot race but does not prove its cause. In the Task 56-G observation, Chromium started before Vite logged readiness, yet the installed launcher already had a one-response `curl` gate. The configured URL, an early transient response, and browser startup behavior were not captured at that instant. A successful HTTP check cannot prove that React rendered or that Chromium's renderer is healthy.

Check shell syntax without starting another browser:

```bash
bash -n "$HOME/.local/bin/smart-vending-kiosk"
```

Then log out and back in, or reboot. The XDG autostart entry launches the readiness-checking script only after the graphical session starts. The Chromium profile remains at `$HOME/.local/state/smart-vending-kiosk/chromium`.

There is intentionally no customer-facing kiosk exit control. Perform maintenance over SSH or with a locally attached keyboard/Linux console. To disable autostart during maintenance, rename or remove `$HOME/.config/autostart/smart-vending-kiosk.desktop`, then restore it when finished.

## Updating the launcher

After Tech Lead review and pulling the change, install the launcher as the graphical-session user. This replaces only the script for the next graphical launch; it does not restart or refresh a running Chromium session:

```bash
cd /home/user/smart-vending
bash -n edge/kiosk/launch-chromium-kiosk.sh
install -m 0755 edge/kiosk/launch-chromium-kiosk.sh /home/user/.local/bin/smart-vending-kiosk
bash -n /home/user/.local/bin/smart-vending-kiosk
```

The launcher also requires `pgrep` from `procps`; install it with `sudo apt install procps` if absent. Confirm that the graphical-session autostart command points to `/home/user/.local/bin/smart-vending-kiosk`; Raspberry Pi OS may use labwc autostart rather than the repository's XDG desktop entry. Leave the local `smart-vending-kiosk.env` file and browser profile unchanged. At the next owner-approved idle cold boot or graphical login, inspect launcher output and confirm that both readiness checks precede the Chromium process and the customer page renders. Do not close or relaunch Chromium during an active payment. If the bounded check expires, inspect Vite and the configured `KIOSK_URL` before a supervised manual launch.

# Raspberry Pi local service autostart

Task 53 keeps the three local startup responsibilities separate:

- `smart-vending-frontend.service` runs Vite on port 5173.
- `smart-vending-pi-unlock.service` runs the local hardware, face, and audio API on port 5000.
- The existing XDG desktop autostart launches Chromium after the graphical session starts. Its launcher waits until the frontend URL is reachable.

The two system services do not depend on one another. A camera, audio, or ESP32 failure can restart the Pi service without stopping the frontend. Both services use `Restart=on-failure` with a five-second delay. Their standard output and standard error go to journald.

## One-time Raspberry Pi installation

These commands assume Raspberry Pi user `user`, repository path `/home/user/smart-vending`, and the existing Python virtual environment at `/home/user/smart-vending/.venv`.

Sign in as `user`, then run:

```bash
cd /home/user/smart-vending

# The tracked frontend unit deliberately uses this absolute executable path.
test "$(command -v npm)" = /usr/bin/npm
test -x /home/user/smart-vending/.venv/bin/python

sudo install -m 0644 \
  deploy/systemd/smart-vending-frontend.service \
  /etc/systemd/system/smart-vending-frontend.service
sudo install -m 0644 \
  deploy/systemd/smart-vending-pi-unlock.service \
  /etc/systemd/system/smart-vending-pi-unlock.service

install -d -m 0700 /home/user/.config/smart-vending
install -m 0600 \
  deploy/systemd/pi-unlock-service.env.example \
  /home/user/.config/smart-vending/pi-unlock-service.env
nano /home/user/.config/smart-vending/pi-unlock-service.env
```

The example preserves the current machine values. Keep all machine-specific and future outbound Cloud settings in the installed environment file; do not put credentials in the repository or edit them into the unit. The service defaults to `127.0.0.1:5000`, so it remains local-only.

The camera recovery code invokes its fixed helper through non-interactive `sudo`. Ensure the existing sudoers rule permits Linux user `user` to run only `/usr/local/sbin/smart-vending-camera-reset` without a password. This Task does not change the helper or its privilege model.

Install or update the existing kiosk autostart files and its `curl` dependency:

```bash
cd /home/user/smart-vending
sudo apt update
sudo apt install curl
mkdir -p /home/user/.local/bin /home/user/.config/autostart
install -m 0755 edge/kiosk/launch-chromium-kiosk.sh \
  /home/user/.local/bin/smart-vending-kiosk
install -m 0644 edge/kiosk/smart-vending-kiosk.desktop \
  /home/user/.config/autostart/smart-vending-kiosk.desktop
test -f /home/user/.config/smart-vending-kiosk.env || \
  install -m 0644 edge/kiosk/kiosk.env.example \
    /home/user/.config/smart-vending-kiosk.env
```

The conditional copy preserves an existing local kiosk configuration. See [pi-kiosk.md](pi-kiosk.md) for Chromium installation and kiosk-specific maintenance.

Load, enable, and start the services:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now smart-vending-frontend.service
sudo systemctl enable --now smart-vending-pi-unlock.service
```

## Operations

Check status and the local endpoints:

```bash
systemctl status smart-vending-frontend.service
systemctl status smart-vending-pi-unlock.service
curl --fail http://localhost:5173/
curl --fail http://localhost:5000/health
```

Follow or inspect logs:

```bash
journalctl -u smart-vending-frontend.service -f
journalctl -u smart-vending-pi-unlock.service -f
journalctl -u smart-vending-frontend.service -b
journalctl -u smart-vending-pi-unlock.service -b
```

Restart or stop either service independently:

```bash
sudo systemctl restart smart-vending-frontend.service
sudo systemctl restart smart-vending-pi-unlock.service
sudo systemctl stop smart-vending-frontend.service
sudo systemctl stop smart-vending-pi-unlock.service
```

Start stopped services again:

```bash
sudo systemctl start smart-vending-frontend.service
sudo systemctl start smart-vending-pi-unlock.service
```

Disable and uninstall the system services:

```bash
sudo systemctl disable --now smart-vending-frontend.service
sudo systemctl disable --now smart-vending-pi-unlock.service
sudo rm /etc/systemd/system/smart-vending-frontend.service
sudo rm /etc/systemd/system/smart-vending-pi-unlock.service
sudo systemctl daemon-reload
sudo systemctl reset-failed
```

The uninstall commands intentionally preserve `/home/user/.config/smart-vending/pi-unlock-service.env` and the existing kiosk setup. Remove those separately only if their local configuration is no longer needed.

## Raspberry Pi acceptance procedure

1. Complete the installation above. Confirm both services are enabled:

   ```bash
   systemctl is-enabled smart-vending-frontend.service
   systemctl is-enabled smart-vending-pi-unlock.service
   ```

2. Reboot without manually starting either application:

   ```bash
   sudo reboot
   ```

3. After the graphical desktop and Chromium appear, reconnect by SSH. Verify that both services started during this boot and that their endpoints respond:

   ```bash
   systemctl status smart-vending-frontend.service
   systemctl status smart-vending-pi-unlock.service
   systemctl is-active smart-vending-frontend.service
   systemctl is-active smart-vending-pi-unlock.service
   curl --fail http://localhost:5173/
   curl --fail http://localhost:5000/health
   journalctl -u smart-vending-frontend.service -b --no-pager
   journalctl -u smart-vending-pi-unlock.service -b --no-pager
   ```

4. On the touchscreen, confirm Chromium opened `http://localhost:5173`, the product-selection page appears, and there is no connection-refused page.

5. Verify automatic recovery of each service. Define this helper once in the SSH shell. It polls once per second and returns failure if the endpoint does not become healthy within approximately 30 seconds:

   ```bash
   wait_for_url() {
     local url="$1"
     curl --fail --silent --show-error --output /dev/null \
       --connect-timeout 2 --max-time 2 \
       --retry 30 --retry-all-errors --retry-connrefused \
       --retry-delay 1 --retry-max-time 30 \
       "$url"
   }
   ```

   Record the frontend's current main PID, kill its complete service control group, then wait for Vite to become reachable. Confirm that systemd assigned a new PID and incremented the restart count:

   ```bash
   systemctl show -p MainPID -p NRestarts smart-vending-frontend.service
   sudo systemctl kill --signal=SIGKILL smart-vending-frontend.service
   wait_for_url http://localhost:5173/
   systemctl show -p ActiveState -p MainPID -p NRestarts smart-vending-frontend.service
   curl --fail --silent --show-error http://localhost:5173/ --output /dev/null
   ```

   Repeat the same bounded readiness check for the Pi service:

   ```bash
   systemctl show -p MainPID -p NRestarts smart-vending-pi-unlock.service
   sudo systemctl kill --signal=SIGKILL smart-vending-pi-unlock.service
   wait_for_url http://localhost:5000/health
   systemctl show -p ActiveState -p MainPID -p NRestarts smart-vending-pi-unlock.service
   curl --fail --silent --show-error http://localhost:5000/health
   ```

6. Check the logs for both controlled failures and successful restarts:

   ```bash
   journalctl -u smart-vending-frontend.service -b --no-pager
   journalctl -u smart-vending-pi-unlock.service -b --no-pager
   ```

This procedure validates process and reboot recovery only. It does not test payment power-loss recovery or perform destructive camera, ESP32, dispenser, or payment actions.

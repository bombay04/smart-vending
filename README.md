# Smart Vending Machine

An IoT vending-machine prototype with a React/Vite kiosk and remote portals, an
Express/TypeScript API backed by PostgreSQL, a Raspberry Pi-local Python service,
and an ESP32 that controls the cabinet over USB Serial.

## Architecture

- `frontend/` — customer kiosk plus Staff and Admin portals.
- `backend/` — HTTP API, payment reconciliation, inventory, employee workflows,
  and PostgreSQL access through Prisma.
- `edge/` — Raspberry Pi-local hardware, camera/face, audio, Serial, and Chromium
  kiosk services. This service must remain bound to localhost on the cabinet.
- `firmware/` — ESP32 firmware for relay and sensor handling.
- `deploy/` — Raspberry Pi systemd examples; cloud deployment is not defined here.
- `docs/` — detailed architecture, operations, and acceptance evidence.

See [the canonical project specification](docs/project-spec.md),
[ESP32 protocol](docs/serial-protocol.md), and
[full local system guide](docs/full-system-test-guide.md).

## Local development

Prerequisites are Node.js/npm, Docker with Compose, and Python for Edge tests.
Use the committed lockfiles with `npm ci`. Do not commit local environment files.

Create an ignored root `.env` containing `POSTGRES_DB`, `POSTGRES_USER`, and
`POSTGRES_PASSWORD`. Copy `backend/.env.example` to `backend/.env`, keep its
`DATABASE_URL` consistent with those PostgreSQL settings, and replace only the
documented placeholders needed for the feature being exercised.

Start PostgreSQL and the backend:

```bash
docker compose up -d postgres
cd backend
npm ci
npm run prisma:generate
npx prisma migrate deploy
npm run seed
npm run dev
```

In another terminal, configure and start the frontend:

```bash
cd frontend
npm ci
cp .env.example .env
npm run dev
```

The default local URLs are frontend `http://localhost:5173`, backend
`http://localhost:3000`, PostgreSQL host port `5435`, and Pi-local service
`http://localhost:5000`. Environment names and safe placeholders are documented
in `backend/.env.example`, `frontend/.env.example`,
`deploy/systemd/pi-unlock-service.env.example`, and `edge/kiosk/kiosk.env.example`.

## Raspberry Pi and ESP32

- [Pi service and environment](docs/pi-unlock-service.md)
- [Pi service autostart](docs/pi-autostart.md)
- [Chromium kiosk startup](docs/pi-kiosk.md)
- [Face recognition](docs/pi-face-recognition.md)
- [Firmware/hardware source of truth](docs/task55-firmware-hardware-source-of-truth.md)

Use an operator-verified `/dev/serial/by-id/...` path for the installed ESP32
service. Raw `/dev/ttyUSB*` and `/dev/ttyACM*` names are for discovery and
troubleshooting because Linux may renumber them after reconnects.

## Verification

```bash
# backend
cd backend
npm run lint
npm run format:check
npx tsc --noEmit
npm test

# frontend
cd ../frontend
npx tsc --noEmit
npm test
npm run build

# Raspberry Pi-independent checks (from the repository root)
cd ..
python -B -m unittest discover -s edge/tests -v
python -B -m unittest discover -s edge/face/tests -v
python -B edge/serial_test.py --self-test
bash edge/kiosk/tests/launch-chromium-kiosk.test.sh
docker compose config
```

These automated checks use mocks and do not authorize real payments, physical
unlocks, firmware flashes, or live hardware tests.

## Current status and cloud handoff

Tasks 55 (firmware/hardware source of truth), 56 (power/reboot acceptance and
recovery), and 57 (UX/UI polish) are complete and merged. Task 56-F.3 retains
the documented restart-safe unlock limitation; see
[the final Task 56 acceptance](docs/task56-power-reboot-acceptance.md).

Task 59 will add Cloudflare Access protection for Staff/Admin pages and their
mutation APIs. CORS is not authentication, and those surfaces must not be
publicly exposed without appropriate access control. The Raspberry Pi hardware
service must stay localhost-only and must not be exposed through the cloud.

Task 60 must determine the production PostgreSQL and migration process, runtime
version, backend build/start command, HTTPS origins, frontend API base URL, and
Opn webhook configuration. Never reuse local development credentials in
production. This repository does not yet contain cloud deployment manifests.

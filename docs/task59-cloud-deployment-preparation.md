# Task 59 Cloud Deployment Preparation

This document records provider-independent deployment requirements for Task 60. It does not describe completed cloud infrastructure, Cloudflare configuration, or a deployed production environment.

## Confirmed architecture

The approved deployment remains hybrid:

- **Cloud:** Express API, PostgreSQL, Opn webhook handling, and the Staff/Admin portal behind Cloudflare Access.
- **Raspberry Pi:** customer kiosk UI, face recognition, local audio, the hardware service, and the ESP32 Serial connection.
- **Loopback boundary:** the Pi hardware service must remain bound to `127.0.0.1`. It must not be exposed through the cloud, Cloudflare Tunnel, or the LAN.

The frontend already configures the two destinations independently at build time:

- `VITE_API_BASE_URL` selects the Express/cloud API.
- `VITE_PI_UNLOCK_BASE_URL` selects the Pi-local hardware, face, and audio service.

Task 60 must supply explicit values for each frontend artifact. Vite variables are compiled into the build and must never contain secrets.

## Backend production commands

Use a Node.js version satisfying `^20.19.0 || ^22.12.0 || >=24.0.0`.

From `backend/`:

```text
npm ci
npm run build
npm run migrate:deploy
npm start
```

`npm run build` generates the Prisma Client and compiles TypeScript to `dist/`. The runtime entrypoint is `dist/server.js`. Run `migrate:deploy` as a controlled release step against the selected production database before starting the new application version.

Do not run `npm run seed` automatically on every deployment. The prototype seed updates the configured products and resets the seeded slots to `AVAILABLE`; it is suitable only for an explicitly approved one-time initialization of an empty prototype database.

## Required configuration names

Backend application configuration:

- `NODE_ENV`
- `PORT`
- `DATABASE_URL`
- `CORS_ALLOWED_ORIGINS`
- `KIOSK_MACHINE_ID`
- `OMISE_SECRET_KEY`
- `OMISE_API_VERSION`
- `OMISE_WEBHOOK_SECRET`
- `LINE_CHANNEL_ACCESS_TOKEN`

LINE notifications use the Messaging API broadcast endpoint. The channel access
token is the only LINE recipient configuration: each notification is sent to all
users who are eligible to receive broadcasts from the existing LINE Official
Account. No follower webhook or subscriber table is required. Broadcast delivery
is subject to the LINE Official Account's monthly message allowance and the
Messaging API broadcast rate limit; quota or delivery errors are logged without
automatic retries so a notification failure cannot repeat vending or restocking.

Frontend build configuration:

- `VITE_API_BASE_URL`
- `VITE_PI_UNLOCK_BASE_URL`

The future Pi-local cloud relay will require a cloud API base URL and Cloudflare Access service-token credentials. Task 60 must choose their final variable names and store the credential only in a private, server-side Pi environment file. A service token must never be embedded in frontend code, a `VITE_` variable, or a browser request assembled by the kiosk application.

## Cloudflare Access deployment requirements

Task 60 must place the full cloud portal and API behind Cloudflare Access. The supervised university prototype will use one approved operator group for both Staff and Admin access. This is an infrastructure access boundary, not application-level role-based access control: Cloudflare Access does not make a Staff identity different from an Admin identity inside Express.

Required controls:

1. Protect the Staff and Admin pages and their static application entrypoints.
2. Protect the full API, including employee, restock, kiosk-session, admin-slot, customer payment, and health routes.
3. Configure an exact public exception only for `POST /api/v1/transactions/omise/webhook`. Do not bypass a broader transaction prefix or the entire API.
4. Configure `OMISE_WEBHOOK_SECRET` in production. Signature verification is mandatory even though the backend independently retrieves the referenced Opn charge before applying state changes.
5. Prevent direct access to the application origin around Cloudflare. Prefer a private Cloudflare Tunnel when supported; otherwise use enforceable origin ingress restrictions and Access-token validation appropriate to the selected host.
6. Keep browser portal API requests same-origin where practical. If Task 60 chooses cross-origin browser requests, it must explicitly validate Access cookie, credential, CORS, and OPTIONS-preflight behavior.

Cloudflare configuration, identity-provider setup, DNS changes, certificates, service-token creation, and origin restrictions are Task 60 work and are not completed by this document.

## Raspberry Pi cloud relay requirement

The customer kiosk cannot safely store a Cloudflare service-token secret. Before the protected cloud API can replace the current direct browser connection, Task 60 must add a server-side, loopback-only Pi relay that attaches the service-token headers to outbound HTTPS requests.

The relay must:

- Bind only to `127.0.0.1`.
- Store its service token outside the repository and browser environment.
- Use HTTPS for its cloud connection.
- Implement a strict method-and-path allowlist for only the customer and kiosk-device calls the Pi requires.
- Reject generic forwarding and all Staff/Admin management paths not required by the local kiosk workflow.
- Apply bounded connection and response timeouts and return safe errors.
- Never proxy or expose the Pi hardware, face, audio, Serial, or unlock endpoints.

The existing Pi hardware service remains a separate loopback trust boundary. The relay is not implemented in Task 59.

## Known limitation

Task 56-F.3 remains open: unlock deduplication is process-local and does not survive a Pi service restart when the same unlock request is explicitly repeated. Cloudflare Access and the planned relay do not resolve this physical fulfillment limitation. An uncertain post-payment unlock outcome still requires supervised staff reconciliation.

## Task 60 dependencies

Task 60 cannot begin final configuration until the following are selected or supplied:

- Node.js application hosting provider and supported origin-protection method.
- Managed PostgreSQL provider, connection/TLS requirements, backup policy, and migration release mechanism.
- Production domain and Cloudflare-managed DNS zone.
- Cloudflare Zero Trust/Access setup and service-token ownership/rotation procedure.
- Approved operator identities or identity-provider group membership.
- Final portal, API, health-check, and Opn webhook URLs.
- Production secret storage for database, Opn, LINE, and Pi relay credentials.

These are deployment requirements and handoff inputs, not claims that cloud deployment or access control is already complete.

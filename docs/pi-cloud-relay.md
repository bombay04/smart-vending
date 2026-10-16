# Raspberry Pi Cloud API relay

The Pi kiosk sends cloud API traffic to `http://127.0.0.1:3000`. The relay forwards
only the approved methods and paths to `https://pi-api.smartvendingpt.com` and adds
the Cloudflare Access service-token headers. The browser never receives either
service credential.

The existing local hardware, face, and audio service remains separate at
`http://127.0.0.1:5000`. The relay has no `/unlock` route and cannot select an
arbitrary upstream URL.

## Exact relay surface

Customer kiosk:

- `GET /api/v1/slots`
- `POST /api/v1/transactions/payments`
- `GET /api/v1/transactions/{positiveInteger}/payment-status`
- `POST /api/v1/transactions/{positiveInteger}/cancel`

Pi device workflows:

- `GET /api/v1/kiosk-sessions/current`
- `POST /api/v1/kiosk-sessions/{positiveInteger}/cancel`
- `POST /api/v1/employees/auth/face`
- `POST /api/v1/restocks/mock`
- `POST /api/v1/employees/face-registration/complete`
- `POST /api/v1/kiosk-sessions/{positiveInteger}/draft-delete-result`
- `POST /api/v1/kiosk-sessions/{positiveInteger}/offboarding-complete`

All other methods and paths are local rejections. Query strings are not accepted.
JSON POST bodies are limited to 64 KiB. Responses are limited to 1 MiB. The relay
does not follow redirects or retry POST requests.

## Local configuration

The Pi frontend configuration is:

```text
VITE_API_BASE_URL=http://127.0.0.1:3000
VITE_PI_UNLOCK_BASE_URL=http://127.0.0.1:5000
```

Vite reads these values when its process starts. Restart the existing frontend
service after changing its local environment. Do not use this Pi-configured bundle
as the remote `/staff` or `/admin` portal; the remote portal must use the human
Access hostname.

The relay environment file uses:

```text
PI_CLOUD_UPSTREAM_ORIGIN=https://pi-api.smartvendingpt.com
PI_CLOUD_RELAY_HOST=127.0.0.1
PI_CLOUD_RELAY_PORT=3000
PI_CLOUD_CONNECT_TIMEOUT_SECONDS=5
PI_CLOUD_READ_TIMEOUT_SECONDS=30
CF_ACCESS_CLIENT_ID=<service token Client ID>
CF_ACCESS_CLIENT_SECRET=<service token Client Secret>
```

The last two values are converted to the `CF-Access-Client-Id` and
`CF-Access-Client-Secret` HTTP headers. Keep them only in the installed root-owned
file. The relay logs route templates and failure categories, not headers, bodies,
credentials, or exception text.

## Backend identity verification

Requests whose raw HTTP `Host` is `pi-api.smartvendingpt.com` pass through the Pi
origin guard before CORS, JSON parsing, or application routes. The guard ignores
`X-Forwarded-Host` and related forwarding headers. It verifies the
`Cf-Access-Jwt-Assertion` RS256 signature against the Cloudflare Access team JWKS,
then requires all of the following:

- exact issuer/team domain;
- the dedicated Pi Access application audience;
- unexpired `type: app` token;
- service-token subject shape (`sub` is empty);
- `common_name` equal to the configured Pi service-token Client ID;
- one of the exact allowed methods and paths above.

Signing keys are cached for one hour and refreshed on an unknown key ID. Missing
configuration, key-fetch failure, invalid signature, wrong identity, wrong
audience, and expired tokens all fail closed with HTTP 401. Non-allowlisted Pi-host
routes return 404. Human-host requests continue through the existing Cloudflare
Access and webhook handling.

Backend environment names:

```text
PI_API_HOSTNAME=pi-api.smartvendingpt.com
CLOUDFLARE_ACCESS_TEAM_DOMAIN=https://<team-name>.cloudflareaccess.com
CLOUDFLARE_ACCESS_AUDIENCE=<dedicated Pi application AUD tag>
CLOUDFLARE_ACCESS_SERVICE_TOKEN_CLIENT_ID=<Pi service token Client ID>
```

The Client ID is an identity selector at the origin. The Client Secret is never
configured on the backend.

## Task 60-D.3 Cloudflare and Railway requirements

Before deployment:

1. Create `pi-api.smartvendingpt.com` as a dedicated self-hosted Access application.
2. Create one dedicated Pi service token and a Service Auth policy that accepts
   only that token on the Pi application. Enable strict service-token authentication.
3. Do not add that Service Auth policy to `vending.smartvendingpt.com`.
4. Route the Pi hostname through the existing tunnel to the private Railway backend.
   Preserve the external Host header; do not configure `httpHostHeader` to replace it.
5. Configure the Pi hostname tunnel ingress with Access validation required, the
   correct team name, and only the Pi application AUD tag.
6. Configure the four backend environment values above and restart the backend.
7. Keep Railway's backend private; do not expose a public Railway origin that can
   bypass Cloudflare and the tunnel.
8. Keep the exact human-host webhook bypass for
   `POST /api/v1/transactions/omise/webhook`. Do not add a webhook bypass to the Pi
   hostname.
9. Verify with read-only requests that a valid Pi token can reach Pi-host
   `GET /api/v1/slots`, is denied by the human hostname, and cannot reach admin,
   employee-management, webhook, health, product, or local hardware paths on the
   Pi hostname.
10. During live acceptance, confirm that the origin receives the raw `Host` as
    `pi-api.smartvendingpt.com` and that a verified Access application JWT carries
    the deployed Pi application audience, the exact team-domain issuer, and a
    `common_name` equal to the dedicated Pi service-token Client ID. Perform this
    check without logging the JWT, Client Secret, or service-token headers.

Cloudflare validates Access before the tunnel; the Express guard independently
validates the signed application JWT and service-token identity. Both layers are
required.

## Later approved Pi installation

Do not run these commands until cloud configuration and deployment are approved.

```bash
cd /home/user/smart-vending

sudo useradd --system --no-create-home --shell /usr/sbin/nologin \
  smart-vending-relay

sudo install -d -o root -g root -m 0700 /etc/smart-vending
sudo install -o root -g root -m 0600 \
  deploy/systemd/pi-cloud-relay.env.example \
  /etc/smart-vending/pi-cloud-relay.env
sudoedit /etc/smart-vending/pi-cloud-relay.env

sudo install -o root -g root -m 0644 \
  deploy/systemd/smart-vending-pi-cloud-relay.service \
  /etc/systemd/system/smart-vending-pi-cloud-relay.service

sudo -u smart-vending-relay test -r /home/user/smart-vending/edge/pi_cloud_relay.py
sudo -u smart-vending-relay test -x /home/user/smart-vending/.venv/bin/python

sudo systemctl daemon-reload
sudo systemctl enable --now smart-vending-pi-cloud-relay.service
curl --fail http://127.0.0.1:3000/health
```

Set the two Vite variables in the Pi frontend's untracked environment and restart
the existing frontend service:

```bash
sudo systemctl restart smart-vending-frontend.service
```

Validation must remain non-mutating until physical/payment approval:

```bash
systemctl status smart-vending-pi-cloud-relay.service
journalctl -u smart-vending-pi-cloud-relay.service -b --no-pager
curl --fail http://127.0.0.1:3000/health
curl --fail http://127.0.0.1:3000/api/v1/slots
curl --fail http://127.0.0.1:5000/health
```

Do not put service credentials on command lines during validation. The relay reads
them from its root-owned environment file.

## Known limitations

- Loopback and CORS are exposure reductions, not local authentication. Software on
  the Pi can call the relay. The strict route surface and origin guard limit impact.
- The Flask development server is retained for the single loopback prototype to
  avoid a new dependency. Reassess a production WSGI server before broader use.
- Access signing-key verification needs outbound HTTPS from Railway to the team's
  `cloudflareaccess.com` JWKS endpoint when the cache is empty or keys rotate.
- This work does not alter physical fulfillment. Task 56-F.3 restart-safe unlock
  deduplication remains a known limitation.

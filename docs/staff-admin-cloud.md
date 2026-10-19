# Staff/Admin cloud frontend

The existing Staff and Admin React routes are served by the Railway Express
service at `/staff` and `/admin`. Their API calls are same-origin, so the browser
uses the same Railway backend and PostgreSQL database as the Pi cloud relay.
The portal does not call the Pi or its loopback hardware service.

## Railway build configuration

The current backend-only Railway root directory cannot include the sibling
frontend build. For this single-service deployment, configure the existing
backend service as follows:

- Root Directory: `/`
- Build Command:
  `npm ci --include=dev --prefix frontend && npm run build --prefix frontend && npm ci --include=dev --prefix backend && npm run build --prefix backend`
- Pre-deploy Command: `npm run migrate:deploy --prefix backend`
- Start Command: `npm start --prefix backend`
- Health-check path: `/health`
- Watch paths: `/frontend/**`, `/backend/**`

The explicit `--include=dev` is required because the frontend build uses Vite
and TypeScript, while the backend build and pre-deploy command use Prisma and
TypeScript from their existing `devDependencies`.

Do not set `VITE_API_BASE_URL` for the cloud portal build; its empty default is
same-origin. Do not put Cloudflare service-token values in any `VITE_` variable.
The Pi retains its existing explicit build/runtime configuration pointing API
traffic to its loopback relay and hardware traffic to port 5000.

Keep `vending.smartvendingpt.com` and its API under the existing human
Cloudflare Access application. Preserve only the exact signed Opn webhook
exception. Keep `pi-api.smartvendingpt.com` on the dedicated Service Auth policy;
the backend Pi Origin Guard continues to return 404 for `/staff`, `/admin`, and
Admin API routes on that hostname.

## Acceptance

1. Open `https://vending.smartvendingpt.com/staff` through human Access and
   refresh the page directly.
2. Start Restock and confirm the request is same-origin and creates an active
   Railway kiosk session.
3. Confirm the Pi changes to Face Scan through its existing relay polling, with
   no inbound cloud-to-Pi request.
4. Open and refresh `https://vending.smartvendingpt.com/admin`; confirm employee
   and slot data comes from Railway.
5. Confirm the Pi hostname returns 404 for `/staff`, `/admin`, and Admin APIs.
6. Run one supervised customer read/payment smoke test on the Pi and confirm the
   Opn webhook remains accepted through its existing signed exception.

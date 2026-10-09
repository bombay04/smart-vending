# Task 54 slot and product management

## Architecture and security boundary

`/admin` reads and writes slot configuration only through the backend and PostgreSQL. The customer kiosk reads the same slot/product records from `GET /api/v1/slots`; there is no Admin-to-Pi request and no inbound Cloud-to-Pi connection.

The prototype intentionally has no portal authentication. Therefore `PATCH /api/v1/admin/slots/:slotNumber` is **not safe for unrestricted public Internet exposure**. For Cloud Deployment Preparation, keep the management API behind a trusted network/reverse-proxy access control until a separately reviewed authentication and authorization task is complete. CORS is not authentication. This task does not add login, accounts, roles, JWT, or deployment configuration.

The management API is:

- `GET /api/v1/admin/slots`
- `PATCH /api/v1/admin/slots/:slotNumber` with `name`, `price`, nullable `imageUrl`, and `isActive`

Only physical slots 1–3 are accepted. Configuration never changes `Slot.status`, triggers hardware, or creates a restock event. A non-cancelled `PENDING` payment blocks an edit. Shared or historically purchased products are versioned by creating a new Product and atomically reassigning only the edited slot; existing Transaction product relations and amount snapshots remain unchanged. An unshared Product with no transaction history may be updated in place.

## Automated checks

From the PC repository root:

```powershell
cd C:\smart-vending\backend
npm.cmd test
npx.cmd tsc --noEmit
npm.cmd run lint
npm.cmd run format:check

cd C:\smart-vending\frontend
npm.cmd test
npx.cmd tsc -b --pretty false
npm.cmd run build

cd C:\smart-vending
git diff --check
git status --short
```

No database reset or seed command is required.

## Manual acceptance (54-A through 54-J)

### PC/backend preparation

Use the existing populated database. Do not run a reset or reseed.

```powershell
cd C:\smart-vending
docker compose up -d postgres

cd C:\smart-vending\backend
npm.cmd install
npx.cmd prisma generate
npm.cmd run dev
```

If the Pi opens the PC backend over the LAN, ensure `backend/.env` has the existing `DATABASE_URL` and includes the exact Pi frontend origin in `CORS_ALLOWED_ORIGINS`, then restart the backend. Do not use `*`.

In another PC terminal, verify the three-slot read API:

```powershell
Invoke-RestMethod http://localhost:3000/api/v1/admin/slots | ConvertTo-Json -Depth 6
Invoke-RestMethod http://localhost:3000/api/v1/slots | ConvertTo-Json -Depth 6
```

Both responses must list slot numbers 1, 2, and 3 only.

### Raspberry Pi update

Task 53 already owns frontend startup. Update dependencies/build inputs and restart its existing service; do not start another Vite process.

```bash
cd /home/user/smart-vending
git status --short
cd frontend
npm install
cd ..
sudo systemctl restart smart-vending-frontend.service
systemctl is-active smart-vending-frontend.service
journalctl -u smart-vending-frontend.service -b --no-pager -n 100
```

Confirm the existing `/home/user/smart-vending/frontend/.env` points `VITE_API_BASE_URL` to the reachable PC/backend URL. If it must be changed, restart `smart-vending-frontend.service` again. The Pi hardware service and systemd units are unchanged.

### UI and persistence checks

1. **54-A:** Open `http://<PI_IP>:5173/admin` (or the configured frontend URL plus `/admin`). Switch between **จัดการพนักงาน** and **จัดการช่องสินค้า**. Return to employee management and confirm the existing employee controls remain present.
2. **54-B:** In slot management, confirm exactly ช่อง 1, ช่อง 2, and ช่อง 3 load from the API with product, price, active state, and inventory status.
3. **54-C:** Edit Slot 1, change its name and price, and save. Confirm the saved values are returned by both API commands above.
4. **54-D:** Leave the Pi kiosk on the idle product-selection screen. Within about seven seconds it must show the new Slot 1 values without a browser or service restart.
5. **54-E:** Set an HTTPS image URL and confirm the image is contained inside its product card with name, price, status, and Buy button still readable at 1024×600.
6. **54-F:** First clear the image URL and confirm the first character of the product name appears. Then save a syntactically valid HTTPS URL that returns a broken image and confirm the same first-character fallback appears.
7. **54-G:** Refresh `/admin`, then restart the existing Pi frontend service and refresh the kiosk. Confirm the configuration persists:

   ```bash
   sudo systemctl restart smart-vending-frontend.service
   systemctl is-active smart-vending-frontend.service
   ```

8. **54-H:** Return to `/admin` and verify employee CRUD/face-registration controls. Open `/staff` and verify the existing restock entry flow remains available. No physical restock is required solely for this configuration test.
9. **54-I:** With an AVAILABLE, active slot and a price supported by Opn PromptPay, begin one test purchase and confirm the QR amount equals the updated database price. Cancel it through the existing UI unless payment confirmation itself is required by the test plan. The browser must never submit a price.
10. **54-J:** For a SOLD_OUT slot, change product configuration and confirm it remains SOLD_OUT and cannot be purchased. During a test PENDING payment, attempt to save that slot in `/admin`; the save must be rejected until the payment is terminal or cancelled. Setting a product inactive must also disable purchase. Use only the existing authenticated physical restock workflow to return SOLD_OUT slots to AVAILABLE.

Editing a configured product does not verify or move the physical item. Before enabling sales, an operator must ensure the item physically loaded in each cabinet slot matches the configured product.

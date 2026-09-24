# Omise/Opn PromptPay payments

## Architecture

The customer payment method is Omise/Opn Payments PromptPay QR. The authority chain is:

`Omise/Opn → backend reconciliation → Transaction SUCCESS + Slot SOLD_OUT → Pi-local frontend → POST /unlock`

Payment success completes the sale immediately. Product removal is not a completion condition. If the local unlock request fails after payment, the sale remains successful and the slot remains `SOLD_OUT`; staff assistance is required and no automatic refund is attempted.

The backend creates the PromptPay source and charge in one server-side Opn Charge API request. It reads the slot, product, and price from PostgreSQL and converts the Prisma decimal price to integer satang. The frontend cannot supply a price, product identifier, provider status, or successful-payment flag.

Opn PromptPay currently accepts THB 20.00 through THB 150,000.00. The prototype seed prices are THB 20, THB 25, and THB 30 so all three slots remain purchasable; the backend rejects an out-of-range database price before contacting Opn.

## Configuration

Copy `backend/.env.example` and set these backend-only values:

```dotenv
OMISE_SECRET_KEY=skey_test_replace_me
OMISE_API_VERSION=2019-05-29
OMISE_PROMPTPAY_EXPIRY_MINUTES=15
OMISE_WEBHOOK_SECRET=
```

`OMISE_SECRET_KEY` must never use a `VITE_` prefix or be placed in the frontend environment. Use an Opn test secret key during development. PromptPay must be enabled for the Opn Thailand account.

`OMISE_WEBHOOK_SECRET` is the Base64-encoded secret generated in the Opn Webhooks Settings dashboard. When configured, the backend verifies the hex `Omise-Signature` with HMAC-SHA256 over `<Omise-Signature-Timestamp>.<raw request body>`, accepts either comma-separated signature during secret rotation, compares in constant time, and applies the provider-documented optional five-minute replay window. When it is intentionally absent for local development, webhook data is only a reconciliation trigger: the backend still retrieves the stored charge independently and never trusts the posted status.

Configure the deployed Opn webhook endpoint as:

```text
POST /api/v1/transactions/omise/webhook
```

## HTTP flow

- `POST /api/v1/transactions/payments` with `{ "slotNumber": 1 }` creates a local `PENDING` transaction and an Opn PromptPay charge, then returns safe QR/status fields.
- `GET /api/v1/transactions/:transactionId/payment-status` retrieves the stored Opn charge on the backend and reconciles its status. The frontend polls this endpoint; it never calls Opn with the secret key.
- `POST /api/v1/transactions/omise/webhook` handles `charge.complete` notifications and independently retrieves the referenced charge before applying any state change.

Provider `pending` remains local `PENDING`; `successful` with `paid: true` becomes local `SUCCESS`; `failed` becomes `FAILED`; and `expired` becomes `EXPIRED`. Success and the slot `SOLD_OUT` update run in one database transaction. Terminal results and duplicate notifications are idempotent.

These field and security contracts were checked against the current official Opn/Omise PromptPay, Charge API, Authentication, API Versioning, Events API, and Webhooks documentation. In particular, the QR field is `source.scannable_code.image.download_uri`, charge retrieval is `GET /charges/{id}`, and a webhook only supplies the charge ID used for an authenticated retrieval; posted charge status is never sale authority.

## Local and real-provider validation

Local automated tests mock the provider boundary and do not require a bank payment. Without a publicly reachable webhook, the normal frontend-to-backend status polling path reconciles the charge. In Opn test mode, the charge can be completed from the Opn dashboard as documented by the provider.

Before claiming real end-to-end validation, verify account PromptPay enablement, QR scanning in a supported banking app, successful and failed test charges, webhook signing and delivery on the deployed HTTPS endpoint, and the physical Pi unlock path. No real-provider or physical-bank validation is implied by the automated test suite.

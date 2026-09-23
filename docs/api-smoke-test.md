# API Smoke Test

The backend must be running at [http://localhost:3000](http://localhost:3000), and the PostgreSQL Docker container must be running.

Start the backend from the `backend` directory:

```bash
npm run dev
```

## Health check

```bash
curl http://localhost:3000/health
```

Expected response:

```json
{
  "status": "ok",
  "database": "connected",
  "timestamp": "2026-08-25T00:00:00.000Z"
}
```

## Products

```bash
curl http://localhost:3000/api/v1/products
```

Expected response:

```json
{
  "data": [
    {
      "id": 1,
      "name": "Tissue",
      "price": "20",
      "imageUrl": null,
      "isActive": true
    }
  ]
}
```

## Slots

```bash
curl http://localhost:3000/api/v1/slots
```

Expected response:

```json
{
  "data": [
    {
      "id": 1,
      "slotNumber": 1,
      "status": "AVAILABLE",
      "product": {
        "id": 1,
        "name": "Tissue",
        "price": "20",
        "imageUrl": null
      }
    }
  ]
}
```

## PromptPay payment

Set `OMISE_SECRET_KEY` in `backend/.env` to an Opn test key and use an available slot. Creating the payment returns a real PromptPay QR and starts in `PENDING`; it does not mark the slot sold out.

```bash
curl -X POST http://localhost:3000/api/v1/transactions/payments \
  -H "Content-Type: application/json" \
  -d '{"slotNumber": 1}'
```

Expected response:

```json
{
  "data": {
    "transactionId": 1,
    "slotNumber": 1,
    "productName": "Tissue",
    "amount": "20.00",
    "paymentStatus": "PENDING",
    "slotStatus": "AVAILABLE",
    "qrImageUrl": "https://api.omise.co/...",
    "expiresAt": "2026-09-23T10:00:00.000Z",
    "paidAt": null
  }
}
```

Check status through the backend (the browser must never call Opn directly):

```bash
curl http://localhost:3000/api/v1/transactions/1/payment-status
```

After the Opn charge is `successful` and `paid`, this response becomes `SUCCESS` and the selected slot becomes `SOLD_OUT`. In test mode, use the Opn dashboard to mark the test charge successful or failed. See [opn-payments.md](opn-payments.md) for webhook and local-development details.

## Mock restock

Employee test data may be required because the initial seed does not create an Employee. Use the ID of an active Employee.

```bash
curl -X POST http://localhost:3000/api/v1/restocks/mock \
  -H "Content-Type: application/json" \
  -d '{"employeeId": 1}'
```

Expected response:

```json
{
  "data": {
    "restockId": 1,
    "employeeId": 1,
    "slots": [
      { "slotNumber": 1, "status": "AVAILABLE" },
      { "slotNumber": 2, "status": "AVAILABLE" },
      { "slotNumber": 3, "status": "AVAILABLE" }
    ]
  }
}
```

IDs and timestamps in actual responses may differ from these examples.

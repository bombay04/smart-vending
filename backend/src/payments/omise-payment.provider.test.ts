import assert from "node:assert/strict";
import test from "node:test";
import { OmisePaymentProvider, PAYMENT_EXPIRY_MINUTES } from "./omise-payment.provider";
import { PaymentProviderError } from "./payment-provider";

const chargeResponse = {
  object: "charge",
  id: "chrg_test_abc123",
  status: "pending",
  amount: 2000,
  currency: "THB",
  paid: false,
  expires_at: "2026-09-23T10:00:00.000Z",
  source: {
    scannable_code: {
      image: {
        download_uri: "https://api.omise.co/charges/chrg_test_abc123/qr",
      },
    },
  },
};

test("Omise provider creates a PromptPay charge with a three-minute expiry", async () => {
  const now = Date.parse("2026-10-07T09:00:00.000Z");
  let requestedUrl = "";
  let requestedInit: RequestInit | undefined;
  const fetchMock: typeof fetch = async (input, init) => {
    requestedUrl = input.toString();
    requestedInit = init;
    const requestBody = init?.body as URLSearchParams;
    return new Response(
      JSON.stringify({
        ...chargeResponse,
        expires_at: requestBody.get("expires_at"),
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  };
  const provider = new OmisePaymentProvider(
    "skey_test_private",
    "2019-05-29",
    fetchMock,
    () => now,
  );

  const payment = await provider.createPromptPayPayment({
    amount: 2000,
    localTransactionId: 91,
    description: "Smart Vending test",
  });

  assert.equal(requestedUrl, "https://api.omise.co/charges");
  assert.equal(requestedInit?.method, "POST");
  const headers = requestedInit?.headers as Record<string, string>;
  assert.equal(
    headers.Authorization,
    `Basic ${Buffer.from("skey_test_private:").toString("base64")}`,
  );
  assert.equal(headers["Omise-Version"], "2019-05-29");
  const body = requestedInit?.body as URLSearchParams;
  assert.equal(body.get("amount"), "2000");
  assert.equal(body.get("currency"), "THB");
  assert.equal(body.get("source[type]"), "promptpay");
  assert.equal(body.get("metadata[local_transaction_id]"), "91");
  assert.equal(PAYMENT_EXPIRY_MINUTES, 3);
  assert.equal(body.get("expires_at"), "2026-10-07T09:03:00Z");
  assert.equal(payment.expiresAt, "2026-10-07T09:03:00Z");
  assert.equal(payment.qrImageUrl, chargeResponse.source.scannable_code.image.download_uri);
});

test("Omise provider retrieves the exact stored charge and exposes status and paid", async () => {
  let requestedUrl = "";
  let requestedMethod = "";
  const fetchMock: typeof fetch = async (input, init) => {
    requestedUrl = input.toString();
    requestedMethod = init?.method ?? "";
    return new Response(JSON.stringify({ ...chargeResponse, status: "successful", paid: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  const provider = new OmisePaymentProvider("skey_test_private", "2019-05-29", fetchMock);

  const payment = await provider.retrievePayment("chrg_test_abc123");

  assert.equal(requestedUrl, "https://api.omise.co/charges/chrg_test_abc123");
  assert.equal(requestedMethod, "GET");
  assert.equal(payment.chargeId, "chrg_test_abc123");
  assert.equal(payment.status, "successful");
  assert.equal(payment.paid, true);
});

test("Omise provider failures expose only a safe provider error", async () => {
  const fetchMock: typeof fetch = async () =>
    new Response(JSON.stringify({ message: "skey_test_private rejected" }), { status: 401 });
  const provider = new OmisePaymentProvider("skey_test_private", "2019-05-29", fetchMock);

  await assert.rejects(
    provider.createPromptPayPayment({ amount: 2000, localTransactionId: 91, description: "test" }),
    (error: unknown) =>
      error instanceof PaymentProviderError && !error.message.includes("skey_test_private"),
  );
});

test("Omise provider rejects malformed charge data and insecure QR URLs", async () => {
  const fetchMock: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        ...chargeResponse,
        source: { scannable_code: { image: { download_uri: "http://example.com/qr" } } },
      }),
      { status: 200 },
    );
  const provider = new OmisePaymentProvider("skey_test_private", "2019-05-29", fetchMock);

  await assert.rejects(
    provider.createPromptPayPayment({ amount: 2000, localTransactionId: 91, description: "test" }),
    PaymentProviderError,
  );
});

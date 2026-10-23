import assert from "node:assert/strict";
import test from "node:test";
import {
  LINE_BROADCAST_ENDPOINT,
  LineOwnerReportProvider,
  OwnerReportDeliveryError,
  serializeOwnerReportPayload,
} from "./owner-line-report.provider";

const message = {
  type: "flex" as const,
  altText: "Owner report",
  contents: { type: "bubble" },
};
const payload = serializeOwnerReportPayload(message);
const retryKey = "4f9332a6-92b0-4ab9-b199-0de5046c4b71";

test("owner provider broadcasts with only the dedicated token and captures LINE metadata", async () => {
  let url = "";
  let init: RequestInit | undefined;
  const provider = new LineOwnerReportProvider("owner-only-token", async (input, requestInit) => {
    url = input.toString();
    init = requestInit;
    return new Response(null, { status: 200, headers: { "x-line-request-id": "req-123" } });
  });
  const metadata = await provider.send(payload, retryKey);
  assert.equal(url, LINE_BROADCAST_ENDPOINT);
  assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer owner-only-token");
  assert.equal((init?.headers as Record<string, string>)["X-Line-Retry-Key"], retryKey);
  assert.equal(init?.body, payload);
  assert.equal(Object.hasOwn(JSON.parse(String(init?.body)), "to"), false);
  assert.deepEqual(metadata, {
    status: 200,
    requestId: "req-123",
    acceptedRequestId: null,
    duplicateAccepted: false,
  });
});

test("same-key LINE 409 is accepted only with accepted-request metadata", async () => {
  const accepted = new LineOwnerReportProvider(
    "owner",
    async () =>
      new Response(null, {
        status: 409,
        headers: {
          "x-line-request-id": "duplicate-request",
          "x-line-accepted-request-id": "original-request",
        },
      }),
  );
  assert.deepEqual(await accepted.send(payload, retryKey), {
    status: 409,
    requestId: "duplicate-request",
    acceptedRequestId: "original-request",
    duplicateAccepted: true,
  });

  await assert.rejects(
    new LineOwnerReportProvider("owner", async () => new Response(null, { status: 409 })).send(
      payload,
      retryKey,
    ),
    (error: unknown) =>
      error instanceof OwnerReportDeliveryError &&
      error.statusCode === 409 &&
      error.retryable === false,
  );
});

test("owner provider fails safely for missing tokens, network errors, and LINE API errors", async () => {
  await assert.rejects(
    new LineOwnerReportProvider("").send(payload, retryKey),
    (error: unknown) =>
      error instanceof OwnerReportDeliveryError && error.code === "NOT_CONFIGURED",
  );
  await assert.rejects(
    new LineOwnerReportProvider("owner", async () => {
      throw new Error("owner-secret");
    }).send(payload, retryKey),
    (error: unknown) =>
      error instanceof OwnerReportDeliveryError &&
      error.code === "NETWORK_ERROR" &&
      !error.message.includes("owner-secret"),
  );
  await assert.rejects(
    new LineOwnerReportProvider("owner", async () => new Response(null, { status: 429 })).send(
      payload,
      retryKey,
    ),
    (error: unknown) =>
      error instanceof OwnerReportDeliveryError &&
      error.code === "LINE_API_ERROR" &&
      error.statusCode === 429 &&
      error.retryable === true,
  );

  await assert.rejects(
    new LineOwnerReportProvider("owner", async () => new Response(null, { status: 401 })).send(
      payload,
      retryKey,
    ),
    (error: unknown) =>
      error instanceof OwnerReportDeliveryError &&
      error.statusCode === 401 &&
      error.retryable === false,
  );
});

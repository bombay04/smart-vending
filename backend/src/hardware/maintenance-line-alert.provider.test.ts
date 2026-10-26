import assert from "node:assert/strict";
import test from "node:test";
import { OwnerReportDeliveryError } from "../reports/owner-line-report.provider";
import { getMaintenanceAlertProvider } from "./maintenance-line-alert.provider";

const RETRY_KEY = "2c10fce9-91e8-4d1d-bf99-c9ce6c313957";

test("hardware alert provider authorizes with only the maintenance channel token", async () => {
  let authorization: string | null = null;
  const fakeFetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    authorization = new Headers(init?.headers).get("Authorization");
    return new Response("", {
      status: 200,
      headers: { "x-line-request-id": "maintenance-request" },
    });
  }) as typeof fetch;
  const provider = getMaintenanceAlertProvider(
    {
      LINE_MAINTENANCE_CHANNEL_ACCESS_TOKEN: "maintenance-token",
      LINE_OWNER_CHANNEL_ACCESS_TOKEN: "owner-token-must-not-be-used",
    },
    fakeFetch,
  );

  await provider.send('{"messages":[]}', RETRY_KEY);

  assert.equal(authorization, "Bearer maintenance-token");
  assert.doesNotMatch(authorization ?? "", /owner-token-must-not-be-used/);
});

test("missing maintenance token fails closed without falling back to owner token", async () => {
  let fetchCalled = false;
  const fakeFetch = (async () => {
    fetchCalled = true;
    return new Response("", { status: 200 });
  }) as typeof fetch;
  const provider = getMaintenanceAlertProvider(
    { LINE_OWNER_CHANNEL_ACCESS_TOKEN: "owner-token-must-not-be-used" },
    fakeFetch,
  );

  await assert.rejects(
    provider.send('{"messages":[]}', RETRY_KEY),
    (error: unknown) =>
      error instanceof OwnerReportDeliveryError &&
      error.code === "NOT_CONFIGURED" &&
      error.retryable === false,
  );
  assert.equal(fetchCalled, false);
});

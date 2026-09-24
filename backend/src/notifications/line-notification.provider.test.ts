import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { LineNotificationProvider } from "./line-notification.provider";

function readFilesRecursively(directory: string): string {
  return readdirSync(directory, { withFileTypes: true })
    .map((entry) => {
      const path = resolve(directory, entry.name);
      return entry.isDirectory() ? readFilesRecursively(path) : readFileSync(path, "utf8");
    })
    .join("\n");
}

test("LINE provider uses its fixed server endpoint and formats sale data", async () => {
  let requestedUrl = "";
  let requestedInit: RequestInit | undefined;
  const provider = new LineNotificationProvider(
    { channelAccessToken: "server-only-token", targetId: "server-target" },
    async (input, init) => {
      requestedUrl = input.toString();
      requestedInit = init;
      return new Response(null, { status: 200 });
    },
  );

  await provider.sendSaleNotification({
    productName: "Authoritative Tissue",
    slotNumber: 2,
    priceThb: "20.00",
  });

  assert.equal(requestedUrl, "https://api.line.me/v2/bot/message/push");
  assert.equal(
    (requestedInit?.headers as Record<string, string>).Authorization,
    "Bearer server-only-token",
  );
  assert.deepEqual(JSON.parse(String(requestedInit?.body)), {
    to: "server-target",
    messages: [
      {
        type: "text",
        text: "Successful sale\nProduct: Authoritative Tissue\nSlot: 2\nPrice: THB 20.00",
      },
    ],
  });
});

test("LINE provider formats all three restocked slot mappings as available", async () => {
  let body = "";
  const provider = new LineNotificationProvider(
    { channelAccessToken: "server-only-token", targetId: "server-target" },
    async (_input, init) => {
      body = String(init?.body);
      return new Response(null, { status: 200 });
    },
  );

  await provider.sendRestockNotification({
    slots: [
      { slotNumber: 1, productName: "Tissue", status: "AVAILABLE" },
      { slotNumber: 2, productName: "Wet Wipes", status: "AVAILABLE" },
      { slotNumber: 3, productName: "Sanitary Pads", status: "AVAILABLE" },
    ],
  });

  const message = JSON.parse(body).messages[0].text as string;
  assert.match(message, /^Successful restock/m);
  assert.match(message, /Slot 1: Tissue - AVAILABLE/);
  assert.match(message, /Slot 2: Wet Wipes - AVAILABLE/);
  assert.match(message, /Slot 3: Sanitary Pads - AVAILABLE/);
});

test("LINE provider errors never contain credentials or response content", async () => {
  const token = "line-super-secret-token";
  const targetId = "line-secret-target";
  const provider = new LineNotificationProvider(
    { channelAccessToken: token, targetId },
    async () => new Response(`provider echoed ${token} ${targetId}`, { status: 401 }),
  );

  await assert.rejects(
    provider.sendSaleNotification({
      productName: "Tissue",
      slotNumber: 1,
      priceThb: "20.00",
    }),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      return !message.includes(token) && !message.includes(targetId);
    },
  );
});

test("frontend source and example configuration contain no LINE credentials", () => {
  const frontendDirectory = resolve(__dirname, "../../../frontend");
  const frontendSource = [
    readFilesRecursively(resolve(frontendDirectory, "src")),
    readFileSync(resolve(frontendDirectory, ".env.example"), "utf8"),
  ].join("\n");

  assert.doesNotMatch(frontendSource, /LINE_CHANNEL_ACCESS_TOKEN|LINE_TARGET_ID|VITE_LINE_/);
});

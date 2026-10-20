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

function collectText(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectText);
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) =>
    key === "text" && typeof child === "string" ? [child] : collectText(child),
  );
}

test("LINE provider sends two ordered Thai Flex cards with authoritative sale data", async () => {
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
    priceThb: "20.01",
    slots: [
      { slotNumber: 3, productName: "Sanitary Pads", status: "AVAILABLE" },
      { slotNumber: 2, productName: "Authoritative Tissue", status: "SOLD_OUT" },
      { slotNumber: 1, productName: "Tissue", status: "AVAILABLE" },
    ],
  });

  assert.equal(requestedUrl, "https://api.line.me/v2/bot/message/push");
  assert.equal(
    (requestedInit?.headers as Record<string, string>).Authorization,
    "Bearer server-only-token",
  );
  const payload = JSON.parse(String(requestedInit?.body)) as {
    to: string;
    messages: Array<{ type: string; altText: string; contents: { type: string } }>;
  };
  assert.equal(payload.to, "server-target");
  assert.equal(payload.messages.length, 2);
  assert.deepEqual(
    payload.messages.map((message) => [message.type, message.contents.type]),
    [
      ["flex", "bubble"],
      ["flex", "bubble"],
    ],
  );
  assert.match(payload.messages[0].altText, /^จำหน่ายสินค้าสำเร็จ/);
  assert.match(payload.messages[1].altText, /^สถานะสินค้าปัจจุบัน/);

  const saleText = collectText(payload.messages[0]);
  assert.deepEqual(saleText, [
    "จำหน่ายสินค้าสำเร็จ",
    "สินค้า",
    "Authoritative Tissue",
    "ช่อง",
    "2",
    "ราคา",
    "20.01 บาท",
  ]);
  const statusText = collectText(payload.messages[1]);
  assert.deepEqual(statusText, [
    "สถานะสินค้าปัจจุบัน",
    "ช่อง 1: Tissue",
    "พร้อมจำหน่าย",
    "ช่อง 2: Authoritative Tissue",
    "สินค้าหมด",
    "ช่อง 3: Sanitary Pads",
    "พร้อมจำหน่าย",
  ]);
});

test("LINE provider sends one compact Thai Flex card for restock", async () => {
  let body = "";
  const provider = new LineNotificationProvider(
    { channelAccessToken: "server-only-token", targetId: "server-target" },
    async (_input, init) => {
      body = String(init?.body);
      return new Response(null, { status: 200 });
    },
  );

  await provider.sendRestockNotification({
    employee: { employeeCode: "EMP071", name: "สมพง สมหมาย" },
    slots: [
      { slotNumber: 3, productName: "Sanitary Pads", status: "AVAILABLE" },
      { slotNumber: 1, productName: "Tissue", status: "AVAILABLE" },
      { slotNumber: 2, productName: "Wet Wipes", status: "SOLD_OUT" },
    ],
  });

  const payload = JSON.parse(body) as {
    messages: Array<{ type: string; altText: string; contents: { type: string } }>;
  };
  assert.equal(payload.messages.length, 1);
  assert.equal(payload.messages[0].type, "flex");
  assert.equal(payload.messages[0].contents.type, "bubble");
  assert.equal(
    payload.messages[0].altText,
    "เติมสินค้าสำเร็จโดย EMP071 — สมพง สมหมาย และอัปเดตสถานะทุกช่องแล้ว",
  );
  assert.deepEqual(collectText(payload.messages[0]), [
    "เติมสินค้าสำเร็จ",
    "ผู้ดำเนินการ",
    "EMP071 — สมพง สมหมาย",
    "สถานะสินค้าปัจจุบัน",
    "ช่อง 1: Tissue",
    "พร้อมจำหน่าย",
    "ช่อง 2: Wet Wipes",
    "สินค้าหมด",
    "ช่อง 3: Sanitary Pads",
    "พร้อมจำหน่าย",
  ]);
});

test("LINE restock card handles missing employee details without inventing an identity", async () => {
  let body = "";
  const provider = new LineNotificationProvider(
    { channelAccessToken: "server-only-token", targetId: "server-target" },
    async (_input, init) => {
      body = String(init?.body);
      return new Response(null, { status: 200 });
    },
  );

  await provider.sendRestockNotification({
    employee: null,
    slots: [{ slotNumber: 1, productName: "Tissue", status: "AVAILABLE" }],
  });

  const payload = JSON.parse(body) as {
    messages: Array<{ altText: string; contents: unknown }>;
  };
  assert.equal(payload.messages.length, 1);
  assert.match(payload.messages[0].altText, /ไม่พบข้อมูลผู้ดำเนินการ/);
  assert.deepEqual(collectText(payload.messages[0]), [
    "เติมสินค้าสำเร็จ",
    "ผู้ดำเนินการ",
    "ไม่พบข้อมูลพนักงาน",
    "สถานะสินค้าปัจจุบัน",
    "ช่อง 1: Tissue",
    "พร้อมจำหน่าย",
  ]);
  assert.doesNotMatch(body, /undefined|null/);
});

test("Flex payloads use LINE-compatible message, bubble, box, and text shapes", async () => {
  let body = "";
  const provider = new LineNotificationProvider(
    { channelAccessToken: "server-only-token", targetId: "server-target" },
    async (_input, init) => {
      body = String(init?.body);
      return new Response(null, { status: 200 });
    },
  );

  await provider.sendSaleNotification({
    productName: "Tissue",
    slotNumber: 1,
    priceThb: "21.00",
    slots: [{ slotNumber: 1, productName: "Tissue", status: "SOLD_OUT" }],
  });

  const payload = JSON.parse(body) as { messages: unknown[] };
  assert.ok(payload.messages.length > 0 && payload.messages.length <= 5);
  for (const message of payload.messages) {
    const flex = message as {
      type: string;
      altText: string;
      contents: { type: string; header: { type: string }; body: { type: string } };
    };
    assert.equal(flex.type, "flex");
    assert.ok(flex.altText.length > 0 && flex.altText.length <= 400);
    assert.equal(flex.contents.type, "bubble");
    assert.equal(flex.contents.header.type, "box");
    assert.equal(flex.contents.body.type, "box");
  }
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
      slots: [{ slotNumber: 1, productName: "Tissue", status: "SOLD_OUT" }],
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

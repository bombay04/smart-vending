import assert from "node:assert/strict";
import test from "node:test";
import { buildOwnerReportFlexMessage } from "./owner-report-flex";
import { aggregateDailySales, aggregateWeeklySales, getReportPeriod } from "./sales-report";

function collectText(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectText);
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) =>
    key === "text" && typeof child === "string" ? [child] : collectText(child),
  );
}

test("daily Flex uses approved theme and every required Thai section", () => {
  const period = getReportPeriod("DAILY", new Date("2026-10-23T01:00:00Z"));
  const message = buildOwnerReportFlexMessage(aggregateDailySales([], period));
  const allText = collectText(message).join(" | ");
  assert.equal(message.type, "flex");
  assert.equal(message.contents.type, "bubble");
  assert.equal((message.contents.header as { backgroundColor: string }).backgroundColor, "#15803D");
  assert.match(allText, /SMART VENDING/);
  assert.match(allText, /DAILY REPORT/);
  assert.match(allText, /สรุปยอดขายรายวัน/);
  assert.match(allText, /ยอดขายรวม/);
  assert.match(allText, /22:00–06:00/);
  assert.match(allText, /ยังไม่มีข้อมูลสินค้าขายดี/);
  assert.match(allText, /รายงานอัตโนมัติ • ทุกวัน 08:00 น\./);
  assert.doesNotMatch(allText, /PILOT_KIOSK/);
});

test("weekly Flex uses dark-blue theme and neutral zero-sales fields", () => {
  const period = getReportPeriod("WEEKLY", new Date("2026-10-26T01:00:00Z"));
  const message = buildOwnerReportFlexMessage(aggregateWeeklySales([], period));
  const allText = collectText(message).join(" | ");
  assert.equal((message.contents.header as { backgroundColor: string }).backgroundColor, "#172554");
  assert.match(allText, /WEEKLY REPORT/);
  assert.match(allText, /สรุปยอดขายรายสัปดาห์/);
  assert.match(allText, /เฉลี่ยต่อวัน/);
  assert.match(allText, /ไม่มีข้อมูล/);
  assert.match(allText, /สัปดาห์นี้ยังไม่มียอดขาย/);
  assert.match(allText, /รายงานอัตโนมัติ • ทุกวันจันทร์ 08:00 น\./);
});

test("daily and weekly DEMO cards are prominent and never label totals as real revenue", () => {
  const dailyPeriod = getReportPeriod("DAILY", new Date("2026-10-23T01:00:00Z"));
  const weeklyPeriod = getReportPeriod("WEEKLY", new Date("2026-10-26T01:00:00Z"));
  for (const message of [
    buildOwnerReportFlexMessage(aggregateDailySales([], dailyPeriod, "DEMO_TEST")),
    buildOwnerReportFlexMessage(aggregateWeeklySales([], weeklyPeriod, "DEMO_TEST")),
  ]) {
    const allText = collectText(message).join(" | ");
    assert.match(message.altText, /DEMO \/ TEST MODE/);
    assert.match(allText, /DEMO \/ TEST MODE/);
    assert.match(allText, /ข้อมูลทดสอบ — ไม่ใช่รายได้จริง/);
    assert.match(allText, /มูลค่ารายการทดสอบรวม/);
    assert.doesNotMatch(allText, /ยอดขายรวม/);
    assert.doesNotMatch(allText, /รายงานอัตโนมัติ/);
  }
});

test("scheduled DEMO cards keep approved themes with only a discreet test-data footer", () => {
  const dailyPeriod = getReportPeriod("DAILY", new Date("2026-10-23T01:00:00Z"));
  const weeklyPeriod = getReportPeriod("WEEKLY", new Date("2026-10-26T01:00:00Z"));
  const messages = [
    buildOwnerReportFlexMessage(aggregateDailySales([], dailyPeriod, "DEMO_TEST"), {
      scheduled: true,
    }),
    buildOwnerReportFlexMessage(aggregateWeeklySales([], weeklyPeriod, "DEMO_TEST"), {
      scheduled: true,
    }),
  ];

  assert.equal(
    (messages[0].contents.header as { backgroundColor: string }).backgroundColor,
    "#15803D",
  );
  assert.equal(
    (messages[1].contents.header as { backgroundColor: string }).backgroundColor,
    "#172554",
  );

  for (const message of messages) {
    const allText = collectText(message).join(" | ");
    assert.doesNotMatch(message.altText, /DEMO \/ TEST MODE/);
    assert.doesNotMatch(allText, /DEMO \/ TEST MODE/);
    assert.doesNotMatch(allText, /ข้อมูลทดสอบ — ไม่ใช่รายได้จริง/);
    assert.match(allText, /ข้อมูลจากระบบทดสอบ/);
    assert.match(allText, /มูลค่ารายการทดสอบรวม/);
    assert.doesNotMatch(allText, /ยอดขายรวม/);
    assert.match(allText, /รายงานอัตโนมัติ/);
    assert.doesNotMatch(allText, /รายงานทดสอบแบบสั่งทำงานด้วยตนเอง/);
  }
});

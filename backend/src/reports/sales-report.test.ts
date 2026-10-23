import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateDailySales,
  aggregateWeeklySales,
  getReportPeriod,
  isReportableTransaction,
  type ReportSourceTransaction,
} from "./sales-report";

function sale(
  id: number,
  paidAt: string,
  amountSatang = 2_000,
  overrides: Partial<ReportSourceTransaction> = {},
): ReportSourceTransaction {
  return {
    id,
    productId: 1,
    productName: "น้ำดื่ม",
    amountSatang,
    paidAt: new Date(paidAt),
    paymentStatus: "SUCCESS",
    providerStatus: "successful",
    providerLiveMode: true,
    providerChargeId: `chrg_live_${id}`,
    customerCancelledAt: null,
    ...overrides,
  };
}

test("daily period is the previous Bangkok calendar day with exclusive end", () => {
  const period = getReportPeriod("DAILY", new Date("2026-10-23T01:00:00.000Z"));
  assert.equal(period.start.toISOString(), "2026-10-21T17:00:00.000Z");
  assert.equal(period.end.toISOString(), "2026-10-22T17:00:00.000Z");
});

test("daily aggregation uses finalized amounts and reconciles all five time bands", () => {
  const period = getReportPeriod("DAILY", new Date("2026-10-23T01:00:00.000Z"));
  const report = aggregateDailySales(
    [
      sale(1, "2026-10-21T17:00:00.000Z", 2_000), // 00:00 Bangkok
      sale(2, "2026-10-22T01:00:00.000Z", 2_500), // 08:00
      sale(3, "2026-10-22T04:00:00.000Z", 3_000), // 11:00
      sale(4, "2026-10-22T08:00:00.000Z", 3_500), // 15:00
      sale(5, "2026-10-22T12:00:00.000Z", 4_000), // 19:00
      sale(6, "2026-10-22T15:00:00.000Z", 4_500), // 22:00
    ],
    period,
  );

  assert.equal(report.totalRevenueSatang, 19_500);
  assert.equal(report.totalUnits, 6);
  assert.equal(
    report.timeBands.reduce((sum, bucket) => sum + bucket.revenueSatang, 0),
    report.totalRevenueSatang,
  );
  assert.equal(report.timeBands.at(-1)?.label, "22:00–06:00");
  assert.equal(report.timeBands.at(-1)?.revenueSatang, 6_500);
  assert.equal(report.bestSellingTime?.label, "22:00–06:00");
});

test("success filtering excludes pending, failed, cancelled, test-mode, and boundary-end rows", () => {
  const period = getReportPeriod("DAILY", new Date("2026-10-23T01:00:00.000Z"));
  const valid = sale(1, "2026-10-22T02:00:00.000Z");
  const report = aggregateDailySales(
    [
      valid,
      sale(2, "2026-10-22T02:00:00.000Z", 2_000, { paymentStatus: "PENDING" }),
      sale(3, "2026-10-22T02:00:00.000Z", 2_000, { providerStatus: "failed" }),
      sale(4, "2026-10-22T02:00:00.000Z", 2_000, {
        customerCancelledAt: new Date("2026-10-22T02:01:00.000Z"),
      }),
      sale(5, "2026-10-22T02:00:00.000Z", 2_000, {
        providerChargeId: "chrg_test_abc123",
        providerLiveMode: false,
      }),
      sale(6, period.end.toISOString()),
      sale(7, "2026-10-22T02:00:00.000Z", 2_000, { providerStatus: null }),
      sale(8, "2026-10-22T02:00:00.000Z", 2_000, { providerLiveMode: false }),
    ],
    period,
  );
  assert.equal(isReportableTransaction(valid), true);
  assert.equal(report.totalUnits, 2);
  assert.equal(report.totalRevenueSatang, 4_000);
});

test("LIVE and DEMO_TEST transactions are strictly separated", () => {
  const period = getReportPeriod("DAILY", new Date("2026-10-23T01:00:00.000Z"));
  const live = sale(1, "2026-10-22T02:00:00.000Z");
  const demo = sale(2, "2026-10-22T03:00:00.000Z", 3_000, {
    providerLiveMode: false,
    providerChargeId: "chrg_test_demo",
  });
  const inconsistentTest = sale(3, "2026-10-22T04:00:00.000Z", 4_000, {
    providerLiveMode: true,
    providerChargeId: "chrg_test_inconsistent",
  });

  const liveReport = aggregateDailySales([live, demo, inconsistentTest], period, "LIVE");
  const demoReport = aggregateDailySales([live, demo, inconsistentTest], period, "DEMO_TEST");
  assert.equal(isReportableTransaction(live, "LIVE"), true);
  assert.equal(isReportableTransaction(demo, "LIVE"), false);
  assert.equal(isReportableTransaction(live, "DEMO_TEST"), false);
  assert.equal(isReportableTransaction(demo, "DEMO_TEST"), true);
  assert.deepEqual([liveReport.totalUnits, liveReport.totalRevenueSatang], [1, 2_000]);
  assert.deepEqual([demoReport.totalUnits, demoReport.totalRevenueSatang], [1, 3_000]);
});

test("duplicate transaction IDs are counted once", () => {
  const period = getReportPeriod("DAILY", new Date("2026-10-23T01:00:00.000Z"));
  const transaction = sale(10, "2026-10-22T03:00:00.000Z", 2_500);
  const report = aggregateDailySales([transaction, structuredClone(transaction)], period);
  assert.equal(report.totalUnits, 1);
  assert.equal(report.totalRevenueSatang, 2_500);
});

test("top products use units, revenue, name, and ID as deterministic tie breakers", () => {
  const period = getReportPeriod("DAILY", new Date("2026-10-23T01:00:00.000Z"));
  const report = aggregateDailySales(
    [
      sale(1, "2026-10-22T01:00:00Z", 2_000, { productId: 3, productName: "ค" }),
      sale(2, "2026-10-22T02:00:00Z", 3_000, { productId: 2, productName: "ข" }),
      sale(3, "2026-10-22T03:00:00Z", 3_000, { productId: 1, productName: "ก (ชื่อเดิม)" }),
      sale(4, "2026-10-22T04:00:00Z", 3_000, { productId: 1, productName: "ก" }),
    ],
    period,
  );
  assert.deepEqual(
    report.topProducts.map((product) => [product.name, product.units]),
    [
      ["ก", 2],
      ["ข", 1],
      ["ค", 1],
    ],
  );
});

test("zero-sales daily report has no invented rankings or peak period", () => {
  const period = getReportPeriod("DAILY", new Date("2026-10-23T01:00:00.000Z"));
  const report = aggregateDailySales([], period);
  assert.equal(report.totalRevenueSatang, 0);
  assert.equal(report.totalUnits, 0);
  assert.equal(report.bestSellingTime, null);
  assert.deepEqual(report.topProducts, []);
});

test("weekly period is the complete previous Monday through Sunday in Bangkok", () => {
  const period = getReportPeriod("WEEKLY", new Date("2026-10-26T01:00:00.000Z"));
  assert.equal(period.start.toISOString(), "2026-10-18T17:00:00.000Z");
  assert.equal(period.end.toISOString(), "2026-10-25T17:00:00.000Z");
});

test("weekly aggregation reconciles weekdays and derives evidence-based KPIs", () => {
  const period = getReportPeriod("WEEKLY", new Date("2026-10-26T01:00:00.000Z"));
  const report = aggregateWeeklySales(
    [
      sale(1, "2026-10-19T01:00:00Z", 2_000), // Monday 08:00
      sale(2, "2026-10-24T03:00:00Z", 3_000), // Saturday 10:00
      sale(3, "2026-10-24T04:00:00Z", 4_000),
    ],
    period,
  );
  assert.equal(report.totalRevenueSatang, 9_000);
  assert.equal(report.averageDailyRevenueSatang, 1_286);
  assert.equal(
    report.weekdays.reduce((sum, day) => sum + day.revenueSatang, 0),
    9_000,
  );
  assert.equal(report.bestSellingWeekday?.label, "วันเสาร์");
  assert.equal(report.peakSalesTime?.label, "10:00–14:00");
  assert.match(report.insight, /วันเสาร์มียอดขายสูงสุด/);
});

test("insufficient weekly history produces a neutral observation", () => {
  const period = getReportPeriod("WEEKLY", new Date("2026-10-26T01:00:00.000Z"));
  assert.match(aggregateWeeklySales([], period).insight, /ยังไม่มียอดขาย/);
  assert.match(
    aggregateWeeklySales([sale(1, "2026-10-19T01:00:00Z")], period).insight,
    /ยังไม่เพียงพอ/,
  );
});

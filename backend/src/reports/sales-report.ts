export type SalesReportType = "DAILY" | "WEEKLY";
export type SalesReportDataMode = "LIVE" | "DEMO_TEST";

export interface ReportPeriod {
  type: SalesReportType;
  start: Date;
  end: Date;
}

export interface ReportSourceTransaction {
  id: number;
  productId: number;
  productName: string;
  amountSatang: number;
  paidAt: Date | null;
  paymentStatus: string;
  providerStatus: string | null;
  providerLiveMode: boolean | null;
  providerChargeId: string | null;
  customerCancelledAt: Date | null;
}

export interface SalesBucket {
  label: string;
  revenueSatang: number;
  units: number;
}

export interface ProductSales {
  productId: number;
  name: string;
  revenueSatang: number;
  units: number;
}

interface SalesReportBase {
  dataMode: SalesReportDataMode;
  period: ReportPeriod;
  totalRevenueSatang: number;
  totalUnits: number;
  topProducts: ProductSales[];
}

export interface DailySalesReport extends SalesReportBase {
  type: "DAILY";
  timeBands: SalesBucket[];
  bestSellingTime: SalesBucket | null;
}

export interface WeeklySalesReport extends SalesReportBase {
  type: "WEEKLY";
  weekdays: SalesBucket[];
  averageDailyRevenueSatang: number;
  bestSellingWeekday: SalesBucket | null;
  timeBands: SalesBucket[];
  peakSalesTime: SalesBucket | null;
  insight: string;
}

export type SalesReport = DailySalesReport | WeeklySalesReport;

const BANGKOK_OFFSET_MILLISECONDS = 7 * 60 * 60 * 1_000;
const DAY_MILLISECONDS = 24 * 60 * 60 * 1_000;

const TIME_BAND_LABELS = [
  "06:00–10:00",
  "10:00–14:00",
  "14:00–18:00",
  "18:00–22:00",
  "22:00–06:00",
] as const;

const WEEKDAY_LABELS = [
  "วันจันทร์",
  "วันอังคาร",
  "วันพุธ",
  "วันพฤหัสบดี",
  "วันศุกร์",
  "วันเสาร์",
  "วันอาทิตย์",
] as const;

function bangkokCalendarDate(date: Date): Date {
  return new Date(date.getTime() + BANGKOK_OFFSET_MILLISECONDS);
}

function bangkokMidnightUtc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day) - BANGKOK_OFFSET_MILLISECONDS);
}

export function getReportPeriod(type: SalesReportType, now = new Date()): ReportPeriod {
  const localNow = bangkokCalendarDate(now);
  const todayStart = bangkokMidnightUtc(
    localNow.getUTCFullYear(),
    localNow.getUTCMonth(),
    localNow.getUTCDate(),
  );

  if (type === "DAILY") {
    return {
      type,
      start: new Date(todayStart.getTime() - DAY_MILLISECONDS),
      end: todayStart,
    };
  }

  const daysSinceMonday = (localNow.getUTCDay() + 6) % 7;
  const currentMonday = new Date(todayStart.getTime() - daysSinceMonday * DAY_MILLISECONDS);
  return {
    type,
    start: new Date(currentMonday.getTime() - 7 * DAY_MILLISECONDS),
    end: currentMonday,
  };
}

export function isReportableTransaction(
  transaction: ReportSourceTransaction,
  dataMode: SalesReportDataMode = "LIVE",
): boolean {
  const chargeId = transaction.providerChargeId?.toLowerCase() ?? null;
  const hasExpectedProviderMode =
    dataMode === "LIVE"
      ? transaction.providerLiveMode === true &&
        chargeId !== null &&
        !chargeId.startsWith("chrg_test_")
      : transaction.providerLiveMode === false && chargeId?.startsWith("chrg_test_") === true;
  return (
    transaction.paymentStatus === "SUCCESS" &&
    (transaction.providerStatus === null || transaction.providerStatus === "successful") &&
    hasExpectedProviderMode &&
    transaction.customerCancelledAt === null &&
    transaction.paidAt !== null &&
    Number.isSafeInteger(transaction.amountSatang) &&
    transaction.amountSatang > 0
  );
}

function reportableTransactions(
  transactions: ReportSourceTransaction[],
  period: ReportPeriod,
  dataMode: SalesReportDataMode,
): ReportSourceTransaction[] {
  const unique = new Map<number, ReportSourceTransaction>();
  for (const transaction of transactions) {
    if (
      isReportableTransaction(transaction, dataMode) &&
      transaction.paidAt!.getTime() >= period.start.getTime() &&
      transaction.paidAt!.getTime() < period.end.getTime()
    ) {
      unique.set(transaction.id, transaction);
    }
  }
  return [...unique.values()];
}

function timeBandIndex(date: Date): number {
  const hour = bangkokCalendarDate(date).getUTCHours();
  if (hour >= 6 && hour < 10) return 0;
  if (hour >= 10 && hour < 14) return 1;
  if (hour >= 14 && hour < 18) return 2;
  if (hour >= 18 && hour < 22) return 3;
  return 4;
}

function weekdayIndex(date: Date): number {
  return (bangkokCalendarDate(date).getUTCDay() + 6) % 7;
}

function emptyBuckets(labels: readonly string[]): SalesBucket[] {
  return labels.map((label) => ({ label, revenueSatang: 0, units: 0 }));
}

function rankProducts(transactions: ReportSourceTransaction[]): ProductSales[] {
  const products = new Map<
    number,
    ProductSales & { labelPaidAt: number; labelTransactionId: number }
  >();
  for (const transaction of transactions) {
    const labelPaidAt = transaction.paidAt!.getTime();
    const product = products.get(transaction.productId) ?? {
      productId: transaction.productId,
      name: transaction.productName,
      revenueSatang: 0,
      units: 0,
      labelPaidAt,
      labelTransactionId: transaction.id,
    };
    product.units += 1;
    product.revenueSatang += transaction.amountSatang;
    if (
      labelPaidAt > product.labelPaidAt ||
      (labelPaidAt === product.labelPaidAt && transaction.id > product.labelTransactionId)
    ) {
      product.name = transaction.productName;
      product.labelPaidAt = labelPaidAt;
      product.labelTransactionId = transaction.id;
    }
    products.set(transaction.productId, product);
  }

  return [...products.values()]
    .sort(
      (left, right) =>
        right.units - left.units ||
        right.revenueSatang - left.revenueSatang ||
        left.name.localeCompare(right.name, "th") ||
        left.productId - right.productId,
    )
    .map(({ productId, name, revenueSatang, units }) => ({
      productId,
      name,
      revenueSatang,
      units,
    }));
}

function bestNonEmptyBucket(buckets: SalesBucket[]): SalesBucket | null {
  return buckets.reduce<SalesBucket | null>((best, bucket) => {
    if (bucket.units === 0) return best;
    if (!best || bucket.revenueSatang > best.revenueSatang) return bucket;
    return best;
  }, null);
}

function totals(transactions: ReportSourceTransaction[]) {
  return {
    totalRevenueSatang: transactions.reduce(
      (sum, transaction) => sum + transaction.amountSatang,
      0,
    ),
    totalUnits: transactions.length,
    topProducts: rankProducts(transactions).slice(0, 3),
  };
}

function aggregateTimeBands(transactions: ReportSourceTransaction[]): SalesBucket[] {
  const buckets = emptyBuckets(TIME_BAND_LABELS);
  for (const transaction of transactions) {
    const bucket = buckets[timeBandIndex(transaction.paidAt!)];
    bucket.revenueSatang += transaction.amountSatang;
    bucket.units += 1;
  }
  return buckets;
}

export function aggregateDailySales(
  source: ReportSourceTransaction[],
  period: ReportPeriod,
  dataMode: SalesReportDataMode = "LIVE",
): DailySalesReport {
  const transactions = reportableTransactions(source, period, dataMode);
  const timeBands = aggregateTimeBands(transactions);
  return {
    type: "DAILY",
    dataMode,
    period,
    ...totals(transactions),
    timeBands,
    bestSellingTime: bestNonEmptyBucket(timeBands),
  };
}

function weeklyInsight(
  transactions: ReportSourceTransaction[],
  weekdays: SalesBucket[],
  bestWeekday: SalesBucket | null,
): string {
  const activeDays = weekdays.filter((weekday) => weekday.units > 0).length;
  if (transactions.length === 0) {
    return "สัปดาห์นี้ยังไม่มียอดขาย";
  }
  if (transactions.length < 3 || activeDays < 2 || !bestWeekday) {
    return "ข้อมูลยอดขายยังไม่เพียงพอสำหรับสรุปแนวโน้ม";
  }
  return `${bestWeekday.label}มียอดขายสูงสุด ควรตรวจสอบสินค้าให้พร้อมก่อนช่วงดังกล่าว`;
}

export function aggregateWeeklySales(
  source: ReportSourceTransaction[],
  period: ReportPeriod,
  dataMode: SalesReportDataMode = "LIVE",
): WeeklySalesReport {
  const transactions = reportableTransactions(source, period, dataMode);
  const weekdays = emptyBuckets(WEEKDAY_LABELS);
  for (const transaction of transactions) {
    const bucket = weekdays[weekdayIndex(transaction.paidAt!)];
    bucket.revenueSatang += transaction.amountSatang;
    bucket.units += 1;
  }
  const timeBands = aggregateTimeBands(transactions);
  const aggregate = totals(transactions);
  const bestSellingWeekday = bestNonEmptyBucket(weekdays);
  return {
    type: "WEEKLY",
    dataMode,
    period,
    ...aggregate,
    weekdays,
    averageDailyRevenueSatang: Math.round(aggregate.totalRevenueSatang / 7),
    bestSellingWeekday,
    timeBands,
    peakSalesTime: bestNonEmptyBucket(timeBands),
    insight: weeklyInsight(transactions, weekdays, bestSellingWeekday),
  };
}

export function aggregateSalesReport(
  type: SalesReportType,
  source: ReportSourceTransaction[],
  period: ReportPeriod,
  dataMode: SalesReportDataMode = "LIVE",
): SalesReport {
  return type === "DAILY"
    ? aggregateDailySales(source, period, dataMode)
    : aggregateWeeklySales(source, period, dataMode);
}

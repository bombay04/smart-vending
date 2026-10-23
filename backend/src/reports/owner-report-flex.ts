import type {
  DailySalesReport,
  ProductSales,
  SalesBucket,
  SalesReport,
  WeeklySalesReport,
} from "./sales-report";

type FlexComponent = Record<string, unknown>;

export interface OwnerReportFlexMessage {
  type: "flex";
  altText: string;
  contents: FlexComponent;
}

const GREEN = "#15803D";
const DARK_BLUE = "#172554";

function money(satang: number): string {
  return `${(satang / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} บาท`;
}

function thaiDate(date: Date): string {
  return new Intl.DateTimeFormat("th-TH-u-ca-gregory", {
    timeZone: "Asia/Bangkok",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function reportDateRange(report: SalesReport): string {
  if (report.type === "DAILY") return thaiDate(report.period.start);
  return `${thaiDate(report.period.start)} – ${thaiDate(
    new Date(report.period.end.getTime() - 1),
  )}`;
}

function text(value: string, options: Record<string, unknown> = {}): FlexComponent {
  return { type: "text", text: value, ...options };
}

function separator(): FlexComponent {
  return { type: "separator", margin: "lg", color: "#E2E8F0" };
}

function sectionTitle(value: string): FlexComponent {
  return text(value, {
    color: "#334155",
    size: "sm",
    weight: "bold",
    margin: "lg",
  });
}

function header(reportName: string, thaiTitle: string, date: string, color: string): FlexComponent {
  return {
    type: "box",
    layout: "vertical",
    backgroundColor: color,
    paddingAll: "18px",
    contents: [
      text("SMART VENDING", { color: "#DCFCE7", size: "xs", weight: "bold" }),
      text(reportName, { color: "#FFFFFF", size: "xl", weight: "bold", margin: "sm" }),
      text(thaiTitle, { color: "#FFFFFF", size: "md", weight: "bold", margin: "sm" }),
      text(date, { color: "#E2E8F0", size: "sm", margin: "md" }),
    ],
  };
}

function primaryRevenue(amount: number, label: string): FlexComponent {
  return {
    type: "box",
    layout: "vertical",
    contents: [
      text(label, { color: "#64748B", size: "sm" }),
      text(money(amount), {
        color: "#0F172A",
        size: "xxl",
        weight: "bold",
        margin: "sm",
        wrap: true,
      }),
    ],
  };
}

function demoBanner(): FlexComponent {
  return {
    type: "box",
    layout: "vertical",
    backgroundColor: "#FFF7ED",
    borderColor: "#F97316",
    borderWidth: "2px",
    cornerRadius: "8px",
    paddingAll: "12px",
    margin: "none",
    contents: [
      text("DEMO / TEST MODE", {
        color: "#C2410C",
        size: "md",
        weight: "bold",
        align: "center",
      }),
      text("ข้อมูลทดสอบ — ไม่ใช่รายได้จริง", {
        color: "#9A3412",
        size: "sm",
        weight: "bold",
        align: "center",
        margin: "sm",
        wrap: true,
      }),
    ],
  };
}

function kpi(label: string, value: string): FlexComponent {
  return {
    type: "box",
    layout: "vertical",
    backgroundColor: "#F8FAFC",
    cornerRadius: "8px",
    paddingAll: "10px",
    flex: 1,
    contents: [
      text(label, { color: "#64748B", size: "xs", wrap: true }),
      text(value, { color: "#0F172A", size: "sm", weight: "bold", margin: "sm", wrap: true }),
    ],
  };
}

function horizontalBar(bucket: SalesBucket, maximum: number, color: string): FlexComponent {
  const barLength =
    bucket.revenueSatang === 0 ? 0 : Math.max(1, Math.round((bucket.revenueSatang / maximum) * 10));
  return {
    type: "box",
    layout: "vertical",
    margin: "md",
    contents: [
      {
        type: "box",
        layout: "horizontal",
        contents: [
          text(bucket.label, { color: "#475569", size: "xs", flex: 3 }),
          text(money(bucket.revenueSatang), {
            color: "#0F172A",
            size: "xs",
            align: "end",
            flex: 3,
          }),
        ],
      },
      text(barLength === 0 ? "—" : "█".repeat(barLength), {
        color: barLength === 0 ? "#CBD5E1" : color,
        size: "xs",
        margin: "xs",
      }),
    ],
  };
}

function productRows(products: ProductSales[]): FlexComponent[] {
  if (products.length === 0) {
    return [text("ยังไม่มีข้อมูลสินค้าขายดี", { color: "#64748B", size: "sm", margin: "md" })];
  }
  return products.map((product, index) => ({
    type: "box",
    layout: "horizontal",
    margin: "md",
    contents: [
      text(String(index + 1), { color: "#64748B", size: "sm", flex: 1 }),
      text(product.name, { color: "#0F172A", size: "sm", weight: "bold", wrap: true, flex: 5 }),
      text(`${product.units} ชิ้น`, { color: "#334155", size: "sm", align: "end", flex: 2 }),
    ],
  }));
}

function dailyMessage(report: DailySalesReport): OwnerReportFlexMessage {
  const maximum = Math.max(1, ...report.timeBands.map((bucket) => bucket.revenueSatang));
  const demo = report.dataMode === "DEMO_TEST";
  return {
    type: "flex",
    altText: demo
      ? `DEMO / TEST MODE — ข้อมูลทดสอบ ไม่ใช่รายได้จริง — ${reportDateRange(report)}`
      : `สรุปยอดขายรายวัน ${reportDateRange(report)}: ${money(report.totalRevenueSatang)}`,
    contents: {
      type: "bubble",
      size: "mega",
      header: header(
        "DAILY REPORT",
        demo ? "สรุปรายการทดสอบรายวัน" : "สรุปยอดขายรายวัน",
        reportDateRange(report),
        GREEN,
      ),
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "18px",
        contents: [
          ...(demo ? [demoBanner()] : []),
          primaryRevenue(report.totalRevenueSatang, demo ? "มูลค่ารายการทดสอบรวม" : "ยอดขายรวม"),
          {
            type: "box",
            layout: "horizontal",
            spacing: "sm",
            margin: "lg",
            contents: [
              kpi("จำนวนที่ขาย", `${report.totalUnits} ชิ้น`),
              kpi(
                demo ? "ช่วงทดสอบสูงสุด" : "ช่วงขายดี",
                report.bestSellingTime?.label ?? "ไม่มีข้อมูล",
              ),
            ],
          },
          separator(),
          sectionTitle(demo ? "มูลค่ารายการทดสอบตามช่วงเวลา" : "ยอดขายตามช่วงเวลา"),
          ...report.timeBands.map((bucket) => horizontalBar(bucket, maximum, GREEN)),
          separator(),
          sectionTitle(demo ? "3 สินค้าทดสอบที่มีรายการสูงสุด" : "3 สินค้าขายดี"),
          ...productRows(report.topProducts),
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        paddingAll: "14px",
        backgroundColor: "#F0FDF4",
        contents: [
          text(demo ? "รายงานทดสอบแบบสั่งทำงานด้วยตนเอง" : "รายงานอัตโนมัติ • ทุกวัน 08:00 น.", {
            color: GREEN,
            size: "xs",
            align: "center",
          }),
        ],
      },
    },
  };
}

function weekdayChart(report: WeeklySalesReport): FlexComponent {
  const maximum = Math.max(1, ...report.weekdays.map((weekday) => weekday.revenueSatang));
  const labels = ["จ", "อ", "พ", "พฤ", "ศ", "ส", "อา"];
  return {
    type: "box",
    layout: "horizontal",
    alignItems: "flex-end",
    spacing: "sm",
    margin: "md",
    contents: report.weekdays.map((weekday, index) => {
      const height =
        weekday.revenueSatang === 0
          ? 4
          : Math.max(8, Math.round((weekday.revenueSatang / maximum) * 56));
      return {
        type: "box",
        layout: "vertical",
        flex: 1,
        contents: [
          text(String(Math.round(weekday.revenueSatang / 100)), {
            color: "#64748B",
            size: "xxs",
            align: "center",
          }),
          {
            type: "box",
            layout: "vertical",
            height: `${height}px`,
            backgroundColor: weekday.revenueSatang === 0 ? "#CBD5E1" : "#3B82F6",
            cornerRadius: "3px",
            margin: "xs",
            contents: [],
          },
          text(labels[index], { color: "#334155", size: "xxs", align: "center", margin: "xs" }),
        ],
      };
    }),
  };
}

function weeklyMessage(report: WeeklySalesReport): OwnerReportFlexMessage {
  const demo = report.dataMode === "DEMO_TEST";
  return {
    type: "flex",
    altText: demo
      ? `DEMO / TEST MODE — ข้อมูลทดสอบ ไม่ใช่รายได้จริง — ${reportDateRange(report)}`
      : `สรุปยอดขายรายสัปดาห์ ${reportDateRange(report)}: ${money(report.totalRevenueSatang)}`,
    contents: {
      type: "bubble",
      size: "mega",
      header: header(
        "WEEKLY REPORT",
        demo ? "สรุปรายการทดสอบรายสัปดาห์" : "สรุปยอดขายรายสัปดาห์",
        reportDateRange(report),
        DARK_BLUE,
      ),
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "18px",
        contents: [
          ...(demo ? [demoBanner()] : []),
          primaryRevenue(
            report.totalRevenueSatang,
            demo ? "มูลค่ารายการทดสอบรวมประจำสัปดาห์" : "ยอดขายรวมประจำสัปดาห์",
          ),
          {
            type: "box",
            layout: "horizontal",
            spacing: "sm",
            margin: "lg",
            contents: [
              kpi("เฉลี่ยต่อวัน", money(report.averageDailyRevenueSatang)),
              kpi("จำนวนที่ขาย", `${report.totalUnits} ชิ้น`),
              kpi(
                demo ? "วันที่ทดสอบสูงสุด" : "วันที่ขายดี",
                report.bestSellingWeekday?.label ?? "ไม่มีข้อมูล",
              ),
            ],
          },
          separator(),
          sectionTitle(demo ? "มูลค่ารายการทดสอบรายวัน (บาท)" : "ยอดขายรายวัน (บาท)"),
          weekdayChart(report),
          separator(),
          sectionTitle("ข้อมูลเชิงธุรกิจ"),
          text(
            `${demo ? "ช่วงทดสอบสูงสุด" : "ช่วงขายดี"}: ${report.peakSalesTime?.label ?? "ไม่มีข้อมูล"}`,
            {
              color: "#334155",
              size: "sm",
              margin: "md",
            },
          ),
          text(
            `${demo ? "สินค้าทดสอบสูงสุด" : "สินค้าขายดี"}: ${report.topProducts[0]?.name ?? "ไม่มีข้อมูล"}`,
            {
              color: "#334155",
              size: "sm",
              margin: "sm",
              wrap: true,
            },
          ),
          text(demo ? report.insight.replaceAll("ยอดขาย", "รายการทดสอบ") : report.insight, {
            color: "#0F172A",
            size: "sm",
            weight: "bold",
            margin: "md",
            wrap: true,
          }),
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        paddingAll: "14px",
        backgroundColor: "#EFF6FF",
        contents: [
          text(
            demo ? "รายงานทดสอบแบบสั่งทำงานด้วยตนเอง" : "รายงานอัตโนมัติ • ทุกวันจันทร์ 08:00 น.",
            {
              color: DARK_BLUE,
              size: "xs",
              align: "center",
            },
          ),
        ],
      },
    },
  };
}

export function buildOwnerReportFlexMessage(report: SalesReport): OwnerReportFlexMessage {
  return report.type === "DAILY" ? dailyMessage(report) : weeklyMessage(report);
}

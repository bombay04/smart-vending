import {
  type NotificationProvider,
  NotificationProviderError,
  type ProductStatusNotificationSlot,
  type RestockNotification,
  type SaleNotification,
} from "./notification-provider";

const LINE_MESSAGING_API_ENDPOINT = "https://api.line.me/v2/bot/message/broadcast";
const LINE_REQUEST_TIMEOUT_MS = 3_000;

interface LineConfiguration {
  channelAccessToken: string;
}

type FlexComponent = Record<string, unknown>;

interface FlexMessage {
  type: "flex";
  altText: string;
  contents: FlexComponent;
}

const statusLabel = (status: ProductStatusNotificationSlot["status"]) =>
  status === "AVAILABLE" ? "พร้อมจำหน่าย" : "สินค้าหมด";

function cardHeader(title: string, color: string): FlexComponent {
  return {
    type: "box",
    layout: "vertical",
    backgroundColor: color,
    paddingAll: "18px",
    contents: [
      {
        type: "text",
        text: title,
        color: "#FFFFFF",
        size: "lg",
        weight: "bold",
        wrap: true,
      },
    ],
  };
}

function detailRow(label: string, value: string): FlexComponent {
  return {
    type: "box",
    layout: "horizontal",
    margin: "md",
    contents: [
      { type: "text", text: label, color: "#64748B", size: "sm", flex: 2 },
      {
        type: "text",
        text: value,
        color: "#0F172A",
        size: "sm",
        weight: "bold",
        align: "end",
        wrap: true,
        flex: 3,
      },
    ],
  };
}

function statusRow(slot: ProductStatusNotificationSlot): FlexComponent {
  const available = slot.status === "AVAILABLE";
  return {
    type: "box",
    layout: "horizontal",
    margin: "md",
    alignItems: "center",
    contents: [
      {
        type: "text",
        text: `ช่อง ${slot.slotNumber}: ${slot.productName ?? "ยังไม่กำหนดสินค้า"}`,
        color: "#0F172A",
        size: "sm",
        wrap: true,
        flex: 5,
      },
      {
        type: "box",
        layout: "vertical",
        backgroundColor: available ? "#DCFCE7" : "#FEE2E2",
        cornerRadius: "12px",
        paddingAll: "6px",
        flex: 3,
        contents: [
          {
            type: "text",
            text: statusLabel(slot.status),
            color: available ? "#166534" : "#B91C1C",
            size: "xs",
            weight: "bold",
            align: "center",
            wrap: true,
          },
        ],
      },
    ],
  };
}

function saleSummaryCard(notification: SaleNotification): FlexMessage {
  return {
    type: "flex",
    altText: `จำหน่ายสินค้าสำเร็จ: ${notification.productName} ช่อง ${notification.slotNumber}`,
    contents: {
      type: "bubble",
      size: "kilo",
      header: cardHeader("จำหน่ายสินค้าสำเร็จ", "#16A34A"),
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "18px",
        contents: [
          detailRow("สินค้า", notification.productName),
          detailRow("ช่อง", String(notification.slotNumber)),
          detailRow("ราคา", `${notification.priceThb} บาท`),
        ],
      },
    },
  };
}

function statusCard(
  title: string,
  altText: string,
  slots: ProductStatusNotificationSlot[],
  headerColor: string,
  leadingContents: FlexComponent[] = [],
): FlexMessage {
  return {
    type: "flex",
    altText,
    contents: {
      type: "bubble",
      size: "kilo",
      header: cardHeader(title, headerColor),
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "18px",
        contents: [
          ...leadingContents,
          ...[...slots].sort((left, right) => left.slotNumber - right.slotNumber).map(statusRow),
        ],
      },
    },
  };
}

function restockOperator(notification: RestockNotification): string | null {
  const employeeCode = notification.employee?.employeeCode.trim() ?? "";
  const name = notification.employee?.name.trim() ?? "";
  const parts = [employeeCode, name].filter(Boolean);
  return parts.length > 0 ? parts.join(" — ") : null;
}

export class LineNotificationProvider implements NotificationProvider {
  constructor(
    private readonly configuration: LineConfiguration,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  sendSaleNotification(notification: SaleNotification): Promise<void> {
    return this.sendMessages([
      saleSummaryCard(notification),
      statusCard(
        "สถานะสินค้าปัจจุบัน",
        "สถานะสินค้าปัจจุบันหลังการจำหน่าย",
        notification.slots,
        "#334155",
      ),
    ]);
  }

  sendRestockNotification(notification: RestockNotification): Promise<void> {
    const operator = restockOperator(notification);
    return this.sendMessages([
      statusCard(
        "เติมสินค้าสำเร็จ",
        operator
          ? `เติมสินค้าสำเร็จโดย ${operator} และอัปเดตสถานะทุกช่องแล้ว`
          : "เติมสินค้าสำเร็จและอัปเดตสถานะทุกช่องแล้ว (ไม่พบข้อมูลผู้ดำเนินการ)",
        notification.slots,
        "#2563EB",
        [
          detailRow("ผู้ดำเนินการ", operator ?? "ไม่พบข้อมูลพนักงาน"),
          { type: "separator", margin: "lg", color: "#E2E8F0" },
          {
            type: "text",
            text: "สถานะสินค้าปัจจุบัน",
            color: "#334155",
            size: "sm",
            weight: "bold",
            margin: "lg",
          },
        ],
      ),
    ]);
  }

  private async sendMessages(messages: FlexMessage[]): Promise<void> {
    const { channelAccessToken } = this.configuration;
    if (!channelAccessToken) {
      throw new NotificationProviderError("LINE notifications are not configured.");
    }

    let response: Response;
    try {
      response = await this.fetchImplementation(LINE_MESSAGING_API_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${channelAccessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages,
        }),
        signal: AbortSignal.timeout(LINE_REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new NotificationProviderError();
    }

    if (!response.ok) {
      throw new NotificationProviderError(
        `Notification provider request failed with status ${response.status}.`,
      );
    }
  }
}

export function getNotificationProvider(): NotificationProvider {
  return new LineNotificationProvider({
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN ?? "",
  });
}

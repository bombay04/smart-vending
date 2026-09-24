import {
  type NotificationProvider,
  NotificationProviderError,
  type RestockNotification,
  type SaleNotification,
} from "./notification-provider";

const LINE_MESSAGING_API_ENDPOINT = "https://api.line.me/v2/bot/message/push";
const LINE_REQUEST_TIMEOUT_MS = 3_000;

interface LineConfiguration {
  channelAccessToken: string;
  targetId: string;
}

function formatSaleMessage(notification: SaleNotification): string {
  return [
    "Successful sale",
    `Product: ${notification.productName}`,
    `Slot: ${notification.slotNumber}`,
    `Price: THB ${notification.priceThb}`,
  ].join("\n");
}

function formatRestockMessage(notification: RestockNotification): string {
  return [
    "Successful restock",
    ...notification.slots.map(
      (slot) =>
        `Slot ${slot.slotNumber}: ${slot.productName ?? "Unassigned product"} - ${slot.status}`,
    ),
  ].join("\n");
}

export class LineNotificationProvider implements NotificationProvider {
  constructor(
    private readonly configuration: LineConfiguration,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  sendSaleNotification(notification: SaleNotification): Promise<void> {
    return this.sendText(formatSaleMessage(notification));
  }

  sendRestockNotification(notification: RestockNotification): Promise<void> {
    return this.sendText(formatRestockMessage(notification));
  }

  private async sendText(message: string): Promise<void> {
    const { channelAccessToken, targetId } = this.configuration;
    if (!channelAccessToken || !targetId) {
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
          to: targetId,
          messages: [{ type: "text", text: message }],
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
    targetId: process.env.LINE_TARGET_ID ?? "",
  });
}

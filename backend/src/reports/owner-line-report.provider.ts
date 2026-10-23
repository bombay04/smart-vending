import type { OwnerReportFlexMessage } from "./owner-report-flex";

export const LINE_BROADCAST_ENDPOINT = "https://api.line.me/v2/bot/message/broadcast";
const LINE_REQUEST_TIMEOUT_MS = 10_000;

export interface OwnerReportDeliveryMetadata {
  status: number;
  requestId: string | null;
  acceptedRequestId: string | null;
  duplicateAccepted: boolean;
}

export interface OwnerReportProvider {
  send(payloadSnapshot: string, retryKey: string): Promise<OwnerReportDeliveryMetadata>;
}

export function serializeOwnerReportPayload(message: OwnerReportFlexMessage): string {
  return JSON.stringify({ messages: [message] });
}

export class OwnerReportDeliveryError extends Error {
  constructor(
    public readonly code: "NOT_CONFIGURED" | "NETWORK_ERROR" | "LINE_API_ERROR",
    public readonly statusCode?: number,
    public readonly retryable = false,
  ) {
    super(
      statusCode
        ? `Owner LINE report delivery failed with status ${statusCode}.`
        : "Owner LINE report delivery failed.",
    );
    this.name = "OwnerReportDeliveryError";
  }
}

export class LineOwnerReportProvider implements OwnerReportProvider {
  constructor(
    private readonly channelAccessToken: string,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  async send(payloadSnapshot: string, retryKey: string): Promise<OwnerReportDeliveryMetadata> {
    if (!this.channelAccessToken) {
      throw new OwnerReportDeliveryError("NOT_CONFIGURED");
    }

    let response: Response;
    try {
      response = await this.fetchImplementation(LINE_BROADCAST_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.channelAccessToken}`,
          "Content-Type": "application/json",
          "X-Line-Retry-Key": retryKey,
        },
        body: payloadSnapshot,
        signal: AbortSignal.timeout(LINE_REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new OwnerReportDeliveryError("NETWORK_ERROR", undefined, true);
    }

    const requestId = response.headers.get("x-line-request-id");
    const acceptedRequestId = response.headers.get("x-line-accepted-request-id")?.trim() || null;
    if (response.status === 409 && acceptedRequestId) {
      return {
        status: response.status,
        requestId,
        acceptedRequestId,
        duplicateAccepted: true,
      };
    }
    if (!response.ok) {
      const retryable =
        response.status === 408 || response.status === 429 || response.status >= 500;
      throw new OwnerReportDeliveryError("LINE_API_ERROR", response.status, retryable);
    }

    return {
      status: response.status,
      requestId,
      acceptedRequestId: null,
      duplicateAccepted: false,
    };
  }
}

export function getOwnerReportProvider(): OwnerReportProvider {
  return new LineOwnerReportProvider(process.env.LINE_OWNER_CHANNEL_ACCESS_TOKEN ?? "");
}

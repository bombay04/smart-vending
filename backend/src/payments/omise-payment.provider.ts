import {
  type CreateProviderPaymentInput,
  type PaymentProvider,
  PaymentProviderError,
  type ProviderPayment,
  type ProviderPaymentStatus,
} from "./payment-provider";

const OMISE_API_URL = "https://api.omise.co";
const DEFAULT_API_VERSION = "2019-05-29";
const DEFAULT_EXPIRY_MINUTES = 15;
const PROVIDER_STATUSES = new Set<ProviderPaymentStatus>([
  "pending",
  "successful",
  "failed",
  "expired",
]);

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: JsonRecord, key: string): string | null {
  return typeof record[key] === "string" ? record[key] : null;
}

function readQrImageUrl(charge: JsonRecord): string | null {
  const source = charge.source;
  if (!isRecord(source) || !isRecord(source.scannable_code)) {
    return null;
  }

  const image = source.scannable_code.image;
  if (!isRecord(image)) {
    return null;
  }

  const downloadUri = readString(image, "download_uri");
  if (!downloadUri) {
    return null;
  }

  try {
    const url = new URL(downloadUri);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function normalizeCharge(value: unknown): ProviderPayment {
  if (!isRecord(value)) {
    throw new PaymentProviderError("Payment provider returned an invalid response.");
  }

  const chargeId = readString(value, "id");
  const status = readString(value, "status");
  const amount = value.amount;
  const currency = readString(value, "currency")?.toUpperCase();
  const paid = value.paid;
  const expiresAt = readString(value, "expires_at");

  if (
    !chargeId ||
    !chargeId.startsWith("chrg_") ||
    !status ||
    !PROVIDER_STATUSES.has(status as ProviderPaymentStatus) ||
    typeof amount !== "number" ||
    !Number.isSafeInteger(amount) ||
    amount <= 0 ||
    currency !== "THB" ||
    typeof paid !== "boolean"
  ) {
    throw new PaymentProviderError("Payment provider returned an invalid response.");
  }

  if (expiresAt !== null && Number.isNaN(Date.parse(expiresAt))) {
    throw new PaymentProviderError("Payment provider returned an invalid response.");
  }

  return {
    chargeId,
    status: status as ProviderPaymentStatus,
    amount,
    currency: "THB",
    paid,
    qrImageUrl: readQrImageUrl(value),
    expiresAt,
  };
}

function getExpiryMinutes(): number {
  const configuredValue = Number(process.env.OMISE_PROMPTPAY_EXPIRY_MINUTES);
  if (Number.isInteger(configuredValue) && configuredValue >= 1 && configuredValue <= 1440) {
    return configuredValue;
  }

  return DEFAULT_EXPIRY_MINUTES;
}

export class OmisePaymentProvider implements PaymentProvider {
  constructor(
    private readonly secretKey: string,
    private readonly apiVersion = DEFAULT_API_VERSION,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {
    if (!secretKey) {
      throw new PaymentProviderError("Payment provider is not configured.");
    }
  }

  async createPromptPayPayment(input: CreateProviderPaymentInput): Promise<ProviderPayment> {
    const expiresAt = new Date(Date.now() + getExpiryMinutes() * 60_000)
      .toISOString()
      .replace(/\.\d{3}Z$/, "Z");
    const body = new URLSearchParams({
      amount: input.amount.toString(),
      currency: "THB",
      "source[type]": "promptpay",
      description: input.description,
      "metadata[local_transaction_id]": input.localTransactionId.toString(),
      expires_at: expiresAt,
    });

    const payment = await this.request("/charges", { method: "POST", body });
    if (payment.status === "pending" && payment.qrImageUrl === null) {
      throw new PaymentProviderError("Payment provider did not return a PromptPay QR code.");
    }

    return payment;
  }

  retrievePayment(chargeId: string): Promise<ProviderPayment> {
    if (!/^chrg_(?:test_)?[0-9a-z]+$/i.test(chargeId)) {
      throw new PaymentProviderError("Payment provider charge identifier is invalid.");
    }

    return this.request(`/charges/${encodeURIComponent(chargeId)}`, { method: "GET" });
  }

  private async request(path: string, init: RequestInit): Promise<ProviderPayment> {
    let response: Response;

    try {
      response = await this.fetchImplementation(`${OMISE_API_URL}${path}`, {
        ...init,
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.secretKey}:`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "Omise-Version": this.apiVersion,
        },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new PaymentProviderError();
    }

    if (!response.ok) {
      throw new PaymentProviderError();
    }

    try {
      return normalizeCharge(await response.json());
    } catch (error: unknown) {
      if (error instanceof PaymentProviderError) {
        throw error;
      }
      throw new PaymentProviderError("Payment provider returned an invalid response.");
    }
  }
}

let configuredProvider: PaymentProvider | undefined;

export function getPaymentProvider(): PaymentProvider {
  if (!configuredProvider) {
    configuredProvider = new OmisePaymentProvider(
      process.env.OMISE_SECRET_KEY ?? "",
      process.env.OMISE_API_VERSION ?? DEFAULT_API_VERSION,
    );
  }

  return configuredProvider;
}

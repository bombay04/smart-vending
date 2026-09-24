export type ProviderPaymentStatus = "pending" | "successful" | "failed" | "expired";

export interface ProviderPayment {
  chargeId: string;
  status: ProviderPaymentStatus;
  amount: number;
  currency: "THB";
  paid: boolean;
  qrImageUrl: string | null;
  expiresAt: string | null;
}

export interface CreateProviderPaymentInput {
  amount: number;
  localTransactionId: number;
  description: string;
}

export interface PaymentProvider {
  createPromptPayPayment(input: CreateProviderPaymentInput): Promise<ProviderPayment>;
  retrievePayment(chargeId: string): Promise<ProviderPayment>;
}

export class PaymentProviderError extends Error {
  constructor(message = "Payment provider is unavailable.") {
    super(message);
    this.name = "PaymentProviderError";
  }
}

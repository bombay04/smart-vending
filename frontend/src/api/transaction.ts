import { API_BASE_URL } from "../config/api";

export type PaymentStatus = "PENDING" | "SUCCESS" | "FAILED" | "EXPIRED";

export interface PaymentResult {
  transactionId: number;
  slotNumber: number;
  productName: string;
  amount: string;
  paymentStatus: PaymentStatus;
  slotStatus: "AVAILABLE" | "SOLD_OUT";
  qrImageUrl?: string;
  expiresAt: string | null;
  paidAt: string | null;
}

interface PaymentResponse {
  data: PaymentResult;
}

async function readPaymentResponse(
  response: Response,
  fallbackMessage: string,
) {
  if (!response.ok) {
    let errorMessage = fallbackMessage;
    try {
      const errorResponse = (await response.json()) as { error?: unknown };
      if (typeof errorResponse.error === "string") {
        errorMessage = errorResponse.error;
      }
    } catch {
      // Keep the customer-safe fallback for a non-JSON response.
    }
    throw new Error(errorMessage);
  }

  return ((await response.json()) as PaymentResponse).data;
}

export async function createPromptPayPayment(
  slotNumber: number,
): Promise<PaymentResult> {
  const response = await fetch(`${API_BASE_URL}/api/v1/transactions/payments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slotNumber }),
  });

  return readPaymentResponse(
    response,
    "Unable to start payment. Please try again.",
  );
}

export async function fetchPaymentStatus(
  transactionId: number,
  signal?: AbortSignal,
): Promise<PaymentResult> {
  const response = await fetch(
    `${API_BASE_URL}/api/v1/transactions/${transactionId}/payment-status`,
    { signal },
  );

  return readPaymentResponse(
    response,
    "Unable to check payment. We will keep trying.",
  );
}

import { API_BASE_URL } from "../config/api";

interface MockPurchaseResult {
  transactionId: number;
  slotNumber: number;
  productName: string;
  amount: string;
  paymentStatus: "SUCCESS";
  slotStatus: "SOLD_OUT";
}

interface MockPurchaseResponse {
  data: MockPurchaseResult;
}

const mockPurchaseUrl = `${API_BASE_URL}/api/v1/transactions/mock-purchase`;

export async function createMockPurchase(slotNumber: number): Promise<MockPurchaseResult> {
  const response = await fetch(mockPurchaseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ slotNumber }),
  });

  if (!response.ok) {
    let errorMessage = "Failed to complete purchase.";

    try {
      const errorResponse = (await response.json()) as { error?: unknown };

      if (typeof errorResponse.error === "string") {
        errorMessage = errorResponse.error;
      }
    } catch {
      // Use the generic error message when the response is not JSON.
    }

    throw new Error(errorMessage);
  }

  const responseData = (await response.json()) as MockPurchaseResponse;

  return responseData.data;
}

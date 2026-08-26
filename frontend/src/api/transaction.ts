import type {
  MockPurchaseRequest,
  MockPurchaseResponse,
  MockPurchaseResult,
} from "../types/transaction";

const mockPurchaseUrl = "http://localhost:3000/api/v1/transactions/mock-purchase";

export async function createMockPurchase(slotNumber: number): Promise<MockPurchaseResult> {
  const requestBody: MockPurchaseRequest = { slotNumber };
  const response = await fetch(mockPurchaseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
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

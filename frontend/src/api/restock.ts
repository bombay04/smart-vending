import { API_BASE_URL } from "../config/api";

export interface RestockedSlot {
  slotNumber: number;
  status: "AVAILABLE";
}

export interface MockRestockResult {
  restockId: number;
  employeeId: number;
  slots: RestockedSlot[];
}

interface MockRestockResponse {
  data: MockRestockResult;
}

const mockRestockUrl = `${API_BASE_URL}/api/v1/restocks/mock`;

export async function createMockRestock(employeeId: number): Promise<MockRestockResult> {
  const response = await fetch(mockRestockUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ employeeId }),
  });

  if (!response.ok) {
    let errorMessage = "Failed to confirm restock. Please try again.";

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

  const responseData = (await response.json()) as MockRestockResponse;

  return responseData.data;
}

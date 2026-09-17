import { API_BASE_URL } from "../config/api";
import type { AuthenticatedEmployee } from "../types/employee";

interface MockEmployeeAuthResponse {
  employee: AuthenticatedEmployee;
}

const mockEmployeeAuthUrl = `${API_BASE_URL}/api/v1/employees/auth/mock`;

export async function authenticateMockEmployee(
  employeeCode: string,
  signal?: AbortSignal,
): Promise<AuthenticatedEmployee> {
  const normalizedEmployeeCode = employeeCode.trim().toUpperCase();

  const response = await fetch(mockEmployeeAuthUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ employeeCode: normalizedEmployeeCode }),
    signal,
  });

  if (!response.ok) {
    let errorMessage = "Employee authentication failed. Please try again.";

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

  const responseData = (await response.json()) as MockEmployeeAuthResponse;

  return responseData.employee;
}

export type AudioEvent =
  | "PAYMENT_SUCCESS"
  | "UNLOCK_FAILED"
  | "EMPLOYEE_AUTH_SUCCESS"
  | "RESTOCK_COMPLETE";

export const AUDIO_EVENTS: Readonly<{
  PAYMENT_SUCCESS: "PAYMENT_SUCCESS";
  UNLOCK_FAILED: "UNLOCK_FAILED";
  EMPLOYEE_AUTH_SUCCESS: "EMPLOYEE_AUTH_SUCCESS";
  RESTOCK_COMPLETE: "RESTOCK_COMPLETE";
}>;

export function sendAudioFeedback(
  playAudio: (event: AudioEvent) => unknown,
  event: AudioEvent,
): Promise<void>;

export function validateEmployeeAndNotify<T>(
  employeeCode: string,
  signal: AbortSignal | undefined,
  dependencies: {
    validateEmployee(
      employeeCode: string,
      signal?: AbortSignal,
    ): Promise<T>;
    playAudio(event: AudioEvent): unknown;
  },
): Promise<T>;

export function commitRestockAndNotify<T>(
  employeeId: number,
  dependencies: {
    commitRestock(employeeId: number): Promise<T>;
    playAudio(event: AudioEvent): unknown;
  },
): Promise<T>;

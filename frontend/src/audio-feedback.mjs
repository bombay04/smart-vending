export const AUDIO_EVENTS = Object.freeze({
  PAYMENT_SUCCESS: "PAYMENT_SUCCESS",
  UNLOCK_FAILED: "UNLOCK_FAILED",
  EMPLOYEE_AUTH_SUCCESS: "EMPLOYEE_AUTH_SUCCESS",
  RESTOCK_COMPLETE: "RESTOCK_COMPLETE",
});

export function sendAudioFeedback(playAudio, event) {
  try {
    Promise.resolve(playAudio(event)).catch(() => {});
  } catch {
    // Audio is feedback only and never changes the completed business action.
  }
}

export async function validateEmployeeAndNotify(
  employeeCode,
  signal,
  { validateEmployee, playAudio },
) {
  const employee = await validateEmployee(employeeCode, signal);

  if (!signal?.aborted) {
    sendAudioFeedback(playAudio, AUDIO_EVENTS.EMPLOYEE_AUTH_SUCCESS);
  }

  return employee;
}

export async function commitRestockAndNotify(
  employeeId,
  { commitRestock, playAudio },
) {
  const restock = await commitRestock(employeeId);
  sendAudioFeedback(playAudio, AUDIO_EVENTS.RESTOCK_COMPLETE);
  return restock;
}

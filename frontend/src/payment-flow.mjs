import { AUDIO_EVENTS, sendAudioFeedback } from "./audio-feedback.mjs";

export function resumeWaitingPaymentAfterCancellationReconciliation(
  currentScreen,
  transactionId,
  payment,
) {
  if (
    currentScreen?.phase !== "waiting" ||
    currentScreen.payment.transactionId !== transactionId
  ) {
    return currentScreen;
  }

  return {
    ...currentScreen,
    payment,
    isCancelling: false,
    cancelError: null,
    pollError: null,
  };
}

function classifyUnpersistedPayment(payment) {
  if (payment.customerCancelled === true) return "CANCELLED";
  if (payment.paymentStatus === "SUCCESS") return "SUCCESS";
  if (
    payment.paymentStatus === "FAILED" ||
    payment.paymentStatus === "EXPIRED"
  ) {
    return "FAILED";
  }
  return "BLOCKED";
}

export async function reconcileUnpersistedPayment(
  payment,
  { cancel, fetchStatus },
) {
  try {
    const cancellationResult = await cancel(payment.transactionId);
    if (cancellationResult.customerCancelled === true) {
      return { action: "CANCELLED", payment: cancellationResult };
    }
  } catch {
    // Reconcile below. A failed request is not proof that cancellation failed.
  }

  try {
    const currentPayment = await fetchStatus(payment.transactionId);
    return {
      action: classifyUnpersistedPayment(currentPayment),
      payment: currentPayment,
    };
  } catch (error) {
    if (error?.status === 404) return { action: "MISSING", payment };
    return { action: "BLOCKED", payment };
  }
}

export async function handleConfirmedPaymentOnce(
  payment,
  attemptedTransactionIds,
  {
    onSaleConfirmed,
    unlock,
    onUnlocked,
    onUnlockFailed,
    beforeUnlockAttempt = () => true,
    onUnlockSuppressed = () => undefined,
    onUnlockSucceeded = () => undefined,
    onUnlockRejected = () => undefined,
    playAudio = () => undefined,
  },
) {
  if (payment.paymentStatus !== "SUCCESS" || payment.customerCancelled === true) {
    return false;
  }

  if (attemptedTransactionIds.has(payment.transactionId)) {
    return false;
  }

  attemptedTransactionIds.add(payment.transactionId);
  onSaleConfirmed(payment);
  if (beforeUnlockAttempt(payment) === false) {
    await onUnlockSuppressed(payment);
    return true;
  }

  try {
    await unlock(payment.slotNumber);
  } catch {
    onUnlockRejected(payment);
    void sendAudioFeedback(playAudio, AUDIO_EVENTS.UNLOCK_FAILED);
    await onUnlockFailed(payment);
    return true;
  }

  onUnlockSucceeded(payment);
  void sendAudioFeedback(playAudio, AUDIO_EVENTS.PAYMENT_SUCCESS);
  await onUnlocked(payment);
  return true;
}

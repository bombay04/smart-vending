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

export async function handleConfirmedPaymentOnce(
  payment,
  attemptedTransactionIds,
  {
    onSaleConfirmed,
    unlock,
    onUnlocked,
    onUnlockFailed,
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
  const paymentSuccessAudio = sendAudioFeedback(
    playAudio,
    AUDIO_EVENTS.PAYMENT_SUCCESS,
  );

  try {
    await unlock(payment.slotNumber);
    await onUnlocked(payment);
  } catch {
    void paymentSuccessAudio.then(() =>
      sendAudioFeedback(playAudio, AUDIO_EVENTS.UNLOCK_FAILED),
    );
    await onUnlockFailed(payment);
  }

  return true;
}

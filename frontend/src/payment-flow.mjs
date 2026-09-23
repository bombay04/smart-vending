export async function handleConfirmedPaymentOnce(
  payment,
  attemptedTransactionIds,
  { onSaleConfirmed, unlock, onUnlocked, onUnlockFailed },
) {
  if (payment.paymentStatus !== "SUCCESS") {
    return false;
  }

  if (attemptedTransactionIds.has(payment.transactionId)) {
    return false;
  }

  attemptedTransactionIds.add(payment.transactionId);
  onSaleConfirmed(payment);

  try {
    await unlock(payment.slotNumber);
    await onUnlocked(payment);
  } catch {
    await onUnlockFailed(payment);
  }

  return true;
}

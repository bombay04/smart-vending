import type { PaymentResult } from "./api/transaction";

interface CompletionDependencies {
  onSaleConfirmed(payment: PaymentResult): void;
  unlock(slotNumber: number): Promise<unknown>;
  onUnlocked(payment: PaymentResult): void | Promise<void>;
  onUnlockFailed(payment: PaymentResult): void | Promise<void>;
}

export function handleConfirmedPaymentOnce(
  payment: PaymentResult,
  attemptedTransactionIds: Set<number>,
  dependencies: CompletionDependencies,
): Promise<boolean>;

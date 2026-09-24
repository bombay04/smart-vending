import type { PaymentResult } from "./api/transaction";
import type { AudioEvent } from "./audio-feedback.mjs";

interface CompletionDependencies {
  onSaleConfirmed(payment: PaymentResult): void;
  unlock(slotNumber: number): Promise<unknown>;
  onUnlocked(payment: PaymentResult): void | Promise<void>;
  onUnlockFailed(payment: PaymentResult): void | Promise<void>;
  playAudio?(event: AudioEvent): unknown;
}

export function handleConfirmedPaymentOnce(
  payment: PaymentResult,
  attemptedTransactionIds: Set<number>,
  dependencies: CompletionDependencies,
): Promise<boolean>;

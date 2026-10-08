import type { PaymentResult } from "./api/transaction";
import type { AudioEvent } from "./audio-feedback.mjs";

interface CompletionDependencies {
  onSaleConfirmed(payment: PaymentResult): void;
  unlock(slotNumber: number, transactionId: number): Promise<unknown>;
  onUnlocked(payment: PaymentResult): void | Promise<void>;
  onUnlockFailed(payment: PaymentResult): void | Promise<void>;
  beforeUnlockAttempt?(payment: PaymentResult): boolean;
  onUnlockSuppressed?(payment: PaymentResult): void | Promise<void>;
  onUnlockAlreadyHandled?(payment: PaymentResult): void | Promise<void>;
  onUnlockSucceeded?(payment: PaymentResult): void;
  onUnlockRejected?(payment: PaymentResult): void;
  playAudio?(event: AudioEvent): unknown;
}

interface WaitingPaymentScreen {
  phase: "waiting";
  payment: PaymentResult;
  pollError: string | null;
  cancelError: string | null;
  isCancelling: boolean;
}

export function resumeWaitingPaymentAfterCancellationReconciliation<T>(
  currentScreen: T,
  transactionId: number,
  payment: PaymentResult,
): T | WaitingPaymentScreen;

export function handleConfirmedPaymentOnce(
  payment: PaymentResult,
  attemptedTransactionIds: Set<number>,
  dependencies: CompletionDependencies,
): Promise<boolean>;

export function reconcileUnpersistedPayment(
  payment: PaymentResult,
  dependencies: {
    cancel(transactionId: number): Promise<PaymentResult>;
    fetchStatus(transactionId: number): Promise<PaymentResult>;
  },
): Promise<{
  action: "CANCELLED" | "SUCCESS" | "FAILED" | "MISSING" | "BLOCKED";
  payment: PaymentResult;
}>;

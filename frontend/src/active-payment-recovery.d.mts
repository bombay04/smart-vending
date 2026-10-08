import type { PaymentResult } from "./api/transaction";

export type FulfillmentState =
  | "NOT_STARTED"
  | "ATTEMPTING"
  | "UNLOCKED"
  | "UNLOCK_FAILED";

export interface ActivePaymentSession {
  version: 1;
  transactionId: number;
  fulfillmentState: FulfillmentState;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const ACTIVE_PAYMENT_STORAGE_KEY: "smart-vending.active-payment.v1";
export const ACTIVE_PAYMENT_SCHEMA_VERSION: 1;
export const FULFILLMENT_STATES: Readonly<{
  NOT_STARTED: "NOT_STARTED";
  ATTEMPTING: "ATTEMPTING";
  UNLOCKED: "UNLOCKED";
  UNLOCK_FAILED: "UNLOCK_FAILED";
}>;

export function readActivePayment(
  storage?: StorageLike,
): ActivePaymentSession | null;

export function persistActivePayment(
  transactionId: number,
  fulfillmentState?: FulfillmentState,
  storage?: StorageLike,
): boolean;

export function clearActivePayment(
  expectedTransactionId?: number,
  storage?: StorageLike,
): boolean;

export function isKioskRefreshShortcut(
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey">,
): boolean;

export function installKioskRefreshGuard(
  target?: Pick<Window, "addEventListener" | "removeEventListener">,
): () => void;

export function getSuccessfulPaymentRecoveryAction(
  fulfillmentState: FulfillmentState,
):
  | "ATTEMPT_UNLOCK"
  | "SHOW_ASSISTANCE"
  | "SHOW_SUCCESS"
  | "SHOW_UNLOCK_FAILED";

export function getPaymentRecoveryAction(
  payment: { paymentStatus: string; customerCancelled?: boolean },
  fulfillmentState: FulfillmentState,
):
  | "CLEAR_CANCELLED"
  | "RESTORE_WAITING"
  | "SHOW_FAILURE"
  | "ATTEMPT_UNLOCK"
  | "SHOW_ASSISTANCE"
  | "SHOW_SUCCESS"
  | "SHOW_UNLOCK_FAILED";

export function getCurrentSuccessfulPaymentRecovery(
  transactionId: number,
  storage?: StorageLike,
): {
  action:
    | "ATTEMPT_UNLOCK"
    | "SHOW_ASSISTANCE"
    | "SHOW_SUCCESS"
    | "SHOW_UNLOCK_FAILED";
  activePayment: ActivePaymentSession | null;
};

export function recoverSuccessfulPaymentOnce(
  payment: PaymentResult,
  activePayment: ActivePaymentSession,
  evaluatedTransactionIds: Set<number>,
  dependencies: {
    attemptUnlock(payment: PaymentResult): void | Promise<void>;
    showAssistance(payment: PaymentResult): void | Promise<void>;
    showSuccess(payment: PaymentResult): void | Promise<void>;
    showUnlockFailed(payment: PaymentResult): void | Promise<void>;
  },
): Promise<boolean>;

export const ACTIVE_PAYMENT_STORAGE_KEY = "smart-vending.active-payment.v1";
export const ACTIVE_PAYMENT_SCHEMA_VERSION = 1;

export const FULFILLMENT_STATES = Object.freeze({
  NOT_STARTED: "NOT_STARTED",
  ATTEMPTING: "ATTEMPTING",
  UNLOCKED: "UNLOCKED",
  UNLOCK_FAILED: "UNLOCK_FAILED",
});

const supportedFulfillmentStates = new Set(Object.values(FULFILLMENT_STATES));

function isStorage(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof value.getItem === "function" &&
    typeof value.setItem === "function" &&
    typeof value.removeItem === "function"
  );
}

function isActivePayment(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    value.version === ACTIVE_PAYMENT_SCHEMA_VERSION &&
    Number.isInteger(value.transactionId) &&
    value.transactionId > 0 &&
    supportedFulfillmentStates.has(value.fulfillmentState)
  );
}

export function readActivePayment(storage = globalThis.localStorage) {
  if (!isStorage(storage)) return null;

  let serialized;
  try {
    serialized = storage.getItem(ACTIVE_PAYMENT_STORAGE_KEY);
  } catch {
    return null;
  }
  if (serialized === null) return null;

  try {
    const activePayment = JSON.parse(serialized);
    if (isActivePayment(activePayment)) return activePayment;
  } catch {
    // The scoped entry is cleared below; unrelated local storage is untouched.
  }

  try {
    storage.removeItem(ACTIVE_PAYMENT_STORAGE_KEY);
  } catch {
    // Storage may be unavailable; malformed data must never crash the kiosk.
  }
  return null;
}

export function persistActivePayment(
  transactionId,
  fulfillmentState = FULFILLMENT_STATES.NOT_STARTED,
  storage = globalThis.localStorage,
) {
  if (
    !isStorage(storage) ||
    !Number.isInteger(transactionId) ||
    transactionId <= 0 ||
    !supportedFulfillmentStates.has(fulfillmentState)
  ) {
    return false;
  }

  try {
    const activePayment = {
      version: ACTIVE_PAYMENT_SCHEMA_VERSION,
      transactionId,
      fulfillmentState,
    };
    storage.setItem(ACTIVE_PAYMENT_STORAGE_KEY, JSON.stringify(activePayment));
    const persistedPayment = JSON.parse(
      storage.getItem(ACTIVE_PAYMENT_STORAGE_KEY) ?? "null",
    );
    return (
      isActivePayment(persistedPayment) &&
      persistedPayment.transactionId === transactionId &&
      persistedPayment.fulfillmentState === fulfillmentState
    );
  } catch {
    return false;
  }
}

export function clearActivePayment(
  expectedTransactionId,
  storage = globalThis.localStorage,
) {
  if (!isStorage(storage)) return false;

  if (expectedTransactionId !== undefined) {
    const activePayment = readActivePayment(storage);
    if (
      activePayment === null ||
      activePayment.transactionId !== expectedTransactionId
    ) {
      return false;
    }
  }

  try {
    storage.removeItem(ACTIVE_PAYMENT_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

export function isKioskRefreshShortcut(event) {
  if (event.key === "F5") return true;
  return event.key.toLowerCase() === "r" && (event.ctrlKey || event.metaKey);
}

export function installKioskRefreshGuard(target = globalThis.window) {
  if (
    target === undefined ||
    typeof target.addEventListener !== "function" ||
    typeof target.removeEventListener !== "function"
  ) {
    return () => undefined;
  }

  const preventRefreshShortcut = (event) => {
    if (!isKioskRefreshShortcut(event)) return;
    event.preventDefault();
    event.stopPropagation();
  };

  target.addEventListener("keydown", preventRefreshShortcut, true);
  return () =>
    target.removeEventListener("keydown", preventRefreshShortcut, true);
}

export function getSuccessfulPaymentRecoveryAction(fulfillmentState) {
  switch (fulfillmentState) {
    case FULFILLMENT_STATES.NOT_STARTED:
      return "ATTEMPT_UNLOCK";
    case FULFILLMENT_STATES.ATTEMPTING:
      return "SHOW_ASSISTANCE";
    case FULFILLMENT_STATES.UNLOCKED:
      return "SHOW_SUCCESS";
    case FULFILLMENT_STATES.UNLOCK_FAILED:
      return "SHOW_UNLOCK_FAILED";
    default:
      throw new TypeError("Unsupported fulfillment state.");
  }
}

export function getPaymentRecoveryAction(payment, fulfillmentState) {
  if (payment.customerCancelled === true) return "CLEAR_CANCELLED";

  switch (payment.paymentStatus) {
    case "PENDING":
      return "RESTORE_WAITING";
    case "FAILED":
    case "EXPIRED":
      return "SHOW_FAILURE";
    case "SUCCESS":
      return getSuccessfulPaymentRecoveryAction(fulfillmentState);
    default:
      throw new TypeError("Unsupported payment status.");
  }
}

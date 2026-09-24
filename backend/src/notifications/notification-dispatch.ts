import type {
  NotificationProvider,
  RestockNotification,
  SaleNotification,
} from "./notification-provider";

export interface NotificationLogger {
  error(message: string, context: { entityId: number; event: "RESTOCK" | "SALE" }): void;
}

export interface NotificationDependencies {
  provider: NotificationProvider;
  logger?: NotificationLogger;
}

const defaultLogger: NotificationLogger = {
  error(message, context) {
    console.error(message, context);
  },
};

async function dispatchAfterClaim(
  entityId: number,
  event: "RESTOCK" | "SALE",
  claim: () => Promise<boolean>,
  send: () => Promise<void>,
  logger: NotificationLogger,
): Promise<void> {
  let claimed = false;
  try {
    claimed = await claim();
  } catch {
    logger.error("Unable to claim notification delivery.", { entityId, event });
    return;
  }

  if (!claimed) {
    return;
  }

  try {
    void send().catch(() => {
      logger.error("Notification provider delivery failed.", { entityId, event });
    });
  } catch {
    logger.error("Notification provider delivery failed.", { entityId, event });
  }
}

export function dispatchSaleNotification(
  transactionId: number,
  notification: SaleNotification,
  claim: () => Promise<boolean>,
  dependencies: NotificationDependencies,
): Promise<void> {
  return dispatchAfterClaim(
    transactionId,
    "SALE",
    claim,
    () => dependencies.provider.sendSaleNotification(notification),
    dependencies.logger ?? defaultLogger,
  );
}

export function dispatchRestockNotification(
  restockId: number,
  notification: RestockNotification,
  claim: () => Promise<boolean>,
  dependencies: NotificationDependencies,
): Promise<void> {
  return dispatchAfterClaim(
    restockId,
    "RESTOCK",
    claim,
    () => dependencies.provider.sendRestockNotification(notification),
    dependencies.logger ?? defaultLogger,
  );
}

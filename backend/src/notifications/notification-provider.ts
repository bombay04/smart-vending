export interface SaleNotification {
  productName: string;
  slotNumber: number;
  priceThb: string;
  slots: ProductStatusNotificationSlot[];
}

export interface ProductStatusNotificationSlot {
  productName: string | null;
  slotNumber: number;
  status: "AVAILABLE" | "SOLD_OUT";
}

export type RestockNotificationSlot = ProductStatusNotificationSlot;

export interface RestockNotificationEmployee {
  employeeCode: string;
  name: string;
}

export interface RestockNotification {
  employee: RestockNotificationEmployee | null;
  slots: RestockNotificationSlot[];
}

export interface NotificationProvider {
  sendSaleNotification(notification: SaleNotification): Promise<void>;
  sendRestockNotification(notification: RestockNotification): Promise<void>;
}

export class NotificationProviderError extends Error {
  constructor(message = "Notification provider request failed.") {
    super(message);
    this.name = "NotificationProviderError";
  }
}

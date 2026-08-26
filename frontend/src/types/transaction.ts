export interface MockPurchaseRequest {
  slotNumber: number;
}

export interface MockPurchaseResult {
  transactionId: number;
  slotNumber: number;
  productName: string;
  amount: string;
  paymentStatus: "SUCCESS";
  slotStatus: "SOLD_OUT";
}

export interface MockPurchaseResponse {
  data: MockPurchaseResult;
}

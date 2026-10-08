export interface UnlockRequest {
  slotNumber: number;
  transactionId: number;
}

export interface UnlockResponse {
  data: {
    transactionId: number;
    slotNumber: number;
    status: string;
    mockHardware: boolean;
    deduplicated: boolean;
  };
}

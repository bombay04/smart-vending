export interface UnlockRequest {
  slotNumber: number;
}

export interface UnlockResponse {
  data: {
    slotNumber: number;
    status: string;
    mockHardware: boolean;
  };
}

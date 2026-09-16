export interface HardwareSlotStatus {
  slotNumber: number;
  productPresent: boolean;
  doorClosed: boolean;
}

export interface HardwareStatusResponse {
  status: "ok";
  slots: HardwareSlotStatus[];
}

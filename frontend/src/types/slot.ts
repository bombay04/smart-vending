export type SlotStatus = "AVAILABLE" | "SOLD_OUT";

export interface SlotProduct {
  id: number;
  name: string;
  price: string;
  imageUrl: string | null;
  isActive: boolean;
}

export interface Slot {
  id: number;
  slotNumber: number;
  status: SlotStatus;
  product: SlotProduct | null;
}

export interface SlotResponse {
  data: Slot[];
}

export interface SlotConfigurationInput {
  name: string;
  price: string;
  imageUrl: string | null;
  isActive: boolean;
}

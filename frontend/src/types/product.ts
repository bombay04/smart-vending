export interface Product {
  id: number;
  name: string;
  price: string;
  imageUrl: string | null;
  isActive: boolean;
}

export interface ProductResponse {
  data: Product[];
}

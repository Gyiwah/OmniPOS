export type OrderItem = {
  productId: string;
  quantity: number;
  unitPrice: number;
};

export type Order = {
  id: string;
  storeId: string;
  createdAt: string;
  total: number;
  items: OrderItem[];
};

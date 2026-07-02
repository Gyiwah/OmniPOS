export type OrderItemForReturn = {
  id: string;
  productId: string | null;
  sku: string | null;
  name: string;
  unitPrice: number;
  purchasedQty: number;
  returnedQty: number;
};

export type OrderForReturn = {
  id: string;
  orderNumber: string;
  createdAt: string;
  customerName: string | null;
  items: OrderItemForReturn[];
};

export type ReturnLineInput = {
  orderItemId: string;
  productId: string | null;
  sku: string | null;
  name: string;
  unitPrice: number;
  quantity: number;
};

export type ReturnListRow = {
  id: string;
  orderId: string;
  orderNumber: string;
  reason: string;
  amount: number;
  createdAt: string;
  itemCount: number;
};

export type ReturnDetail = ReturnListRow & {
  items: {
    id: string;
    name: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }[];
};

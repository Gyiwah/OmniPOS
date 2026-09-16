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
  /**
   * How the sale was paid, in whatever spelling the transport hands back. Money
   * goes back the way it came in, so this is what the refund method defaults to
   * — see defaultRefundMethod. Null when the record does not say.
   */
  paymentMethod: string | null;
  items: OrderItemForReturn[];
};

/**
 * How a refund goes back.
 *
 * The same four the web till offers, spelled the way this app spells them: the
 * checkout picker stores 'momo', and the server canonicalises that to
 * 'mobile_money' through Payment::canonicalMethod, so either spelling is
 * accepted on the wire. Using the app's own word keeps the returns screen
 * reading like the checkout screen beside it.
 */
export type RefundMethod = "cash" | "card" | "transfer" | "momo";

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

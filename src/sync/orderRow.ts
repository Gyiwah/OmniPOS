export type OrderInsertPayload = {
  id?: string;
  store_id: string;
  cashier_user_id: string;
  order_number: string;
  status: string;
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  tax_rate?: number;
  vat_rate?: number;
  service_rate?: number;
  discount_mode?: string;
  discount_value?: number;
  amount_paid: number;
  change_due: number;
  payment_method: string;
  customer_name?: string | null;
  customer_phone?: string | null;
  customer_id?: string | null;
  shipping_address?: string | null;
  items: Array<{
    product_id?: string | null;
    sku?: string | null;
    barcode?: string | null;
    product_name: string;
    unit_price: number;
    quantity: number;
    line_total: number;
  }>;
};

export function buildOrderRowForSupabase(payload: OrderInsertPayload): Record<string, unknown> {
  const row: Record<string, unknown> = {
    store_id: payload.store_id,
    cashier_user_id: payload.cashier_user_id,
    order_number: payload.order_number,
    status: payload.status ?? "completed",
    subtotal: payload.subtotal,
    tax: payload.tax,
    discount: payload.discount,
    total: payload.total,
    tax_rate: payload.tax_rate ?? 0,
    vat_rate: payload.vat_rate ?? 0,
    service_rate: payload.service_rate ?? 0,
    discount_mode: payload.discount_mode ?? "percentage",
    discount_value: payload.discount_value ?? 0,
    amount_paid: payload.amount_paid,
    change_due: payload.change_due,
    payment_method: payload.payment_method ?? "cash",
    customer_name: payload.customer_name ?? null,
    customer_phone: payload.customer_phone ?? null,
    customer_id: payload.customer_id ?? null,
    shipping_address: payload.shipping_address ?? null,
  };

  if (payload.id && payload.id.length > 20) {
    row.id = payload.id;
  }

  return row;
}

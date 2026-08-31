import { api } from "@/src/core/api/client";
import type { OrderForReturn, ReturnDetail, ReturnListRow } from "./types";

/**
 * Return lookups, over the Laravel API.
 *
 * Eligibility comes from the server rather than being worked out here. A till
 * only knows the returns it processed itself, so a locally computed figure goes
 * stale the moment another terminal refunds against the same sale — and the
 * consequence of getting it wrong is refunding a customer twice.
 */

type EligibilityResponse = {
  order: {
    id: string;
    order_number: string;
    client_created_at: string | null;
    customer_name: string | null;
    status: string;
    total: string;
  };
  lines: Array<{
    order_item_id: string;
    product_id: string | null;
    product_name: string;
    unit_price: string;
    quantity_sold: number;
    quantity_returned: number;
    quantity_eligible: number;
  }>;
  fully_returned: boolean;
  refundable_total: string;
};

export async function lookupOrderForReturn(_storeId: string, ref: string): Promise<OrderForReturn | null> {
  const trimmed = ref.trim();
  if (!trimmed) return null;

  // The eligibility endpoint takes an order id. A cashier types a receipt
  // number, so resolve that first.
  const search = await api.get<{ data: Array<{ id: string; order_number: string }> }>("/api/orders", {
    search: trimmed,
    per_page: 5,
  });

  const match =
    search.data?.find((o) => o.order_number.toLowerCase() === trimmed.toLowerCase()) ?? search.data?.[0];

  if (!match) return null;

  let eligibility: EligibilityResponse;
  try {
    eligibility = await api.get<EligibilityResponse>(`/api/returns/eligibility/${match.id}`);
  } catch {
    return null;
  }

  return {
    id: eligibility.order.id,
    orderNumber: eligibility.order.order_number,
    createdAt: eligibility.order.client_created_at ?? "",
    customerName: eligibility.order.customer_name ?? null,
    // Lines with nothing left to return are dropped rather than shown at zero:
    // a cashier should not be offered a row they cannot act on.
    items: eligibility.lines
      .filter((line) => line.quantity_eligible > 0)
      .map((line) => ({
        id: line.order_item_id,
        productId: line.product_id,
        sku: null,
        name: line.product_name,
        unitPrice: Number(line.unit_price),
        purchasedQty: line.quantity_sold,
        // Straight from the server, which counts every return ever recorded
        // against this line — not just the ones this till knows about.
        returnedQty: line.quantity_returned,
      })),
  };
}

export async function listReturns(_storeId: string): Promise<ReturnListRow[]> {
  const res = await api.get<{
    data: Array<{
      id: string;
      order_id: string;
      order_number: string | null;
      reason: string;
      amount: string;
      created_at: string | null;
      client_created_at: string | null;
      items?: Array<{ quantity: number }>;
    }>;
  }>("/api/returns", { per_page: 100 });

  return (res.data ?? []).map((r) => ({
    id: r.id,
    orderId: r.order_id,
    orderNumber: r.order_number ?? "",
    reason: r.reason,
    amount: Number(r.amount),
    createdAt: r.client_created_at ?? r.created_at ?? "",
    itemCount: (r.items ?? []).reduce((sum, i) => sum + Number(i.quantity ?? 0), 0),
  }));
}

export async function getReturnDetail(_storeId: string, returnId: string): Promise<ReturnDetail | null> {
  try {
    const res = await api.get<{
      data: {
        id: string;
        order_id: string;
        order_number: string | null;
        reason: string;
        amount: string;
        created_at: string | null;
        client_created_at: string | null;
        items: Array<{
          id: string;
          product_id: string | null;
          product_name: string;
          unit_price: string;
          quantity: number;
          line_total: string;
        }>;
      };
    }>(`/api/returns/${returnId}`);

    const r = res.data;

    return {
      id: r.id,
      orderId: r.order_id,
      orderNumber: r.order_number ?? "",
      reason: r.reason,
      amount: Number(r.amount),
      createdAt: r.client_created_at ?? r.created_at ?? "",
      itemCount: (r.items ?? []).reduce((sum, i) => sum + Number(i.quantity ?? 0), 0),
      items: (r.items ?? []).map((i) => ({
        id: i.id,
        name: i.product_name,
        quantity: i.quantity,
        unitPrice: Number(i.unit_price),
        lineTotal: Number(i.line_total),
      })),
    };
  } catch {
    return null;
  }
}

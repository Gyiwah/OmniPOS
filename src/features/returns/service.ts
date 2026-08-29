import { supabase } from "@/src/services/supabase";
import { restoreStockForReturn } from "./stock";
import type { OrderForReturn, ReturnDetail, ReturnLineInput, ReturnListRow } from "./types";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_RE.test(value.trim());
}

async function fetchReturnedQtyByOrderItem(
  storeId: string,
  orderId: string,
): Promise<Map<string, number>> {
  const totals = new Map<string, number>();

  const { data: returns, error: returnsError } = await supabase
    .from("returns")
    .select("id")
    .eq("store_id", storeId)
    .eq("order_id", orderId);

  if (returnsError || !returns?.length) return totals;

  const returnIds = returns.map((row) => String(row.id));
  const { data: items, error: itemsError } = await supabase
    .from("return_items")
    .select("order_item_id, quantity")
    .eq("store_id", storeId)
    .in("return_id", returnIds);

  if (itemsError) {
    if (itemsError.message.toLowerCase().includes("return_items")) {
      return totals;
    }
    throw new Error(itemsError.message);
  }

  (items ?? []).forEach((row) => {
    const key = String(row.order_item_id);
    totals.set(key, (totals.get(key) ?? 0) + Number(row.quantity ?? 0));
  });

  return totals;
}

export async function lookupOrderForReturn(storeId: string, ref: string): Promise<OrderForReturn | null> {
  const cleanRef = ref.trim();
  if (!cleanRef) return null;

  let query = supabase
    .from("orders")
    .select("id, order_number, created_at, customer_name, status")
    .eq("store_id", storeId);

  query = isUuid(cleanRef) ? query.eq("id", cleanRef) : query.eq("order_number", cleanRef);

  const { data: order, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  if (!order) return null;

  if (String(order.status) === "voided") {
    throw new Error("This order was voided and cannot be returned.");
  }

  const { data: items, error: itemsError } = await supabase
    .from("order_items")
    .select("id, product_id, sku, product_name, unit_price, quantity")
    .eq("store_id", storeId)
    .eq("order_id", order.id)
    .order("created_at", { ascending: true });

  if (itemsError) throw new Error(itemsError.message);

  const returnedByItem = await fetchReturnedQtyByOrderItem(storeId, String(order.id));

  return {
    id: String(order.id),
    orderNumber: String(order.order_number),
    createdAt: String(order.created_at),
    customerName: (order.customer_name as string | null) ?? null,
    items: (items ?? []).map((item) => ({
      id: String(item.id),
      productId: item.product_id ? String(item.product_id) : null,
      sku: item.sku ? String(item.sku) : null,
      name: String(item.product_name),
      unitPrice: Number(item.unit_price ?? 0),
      purchasedQty: Number(item.quantity ?? 0),
      returnedQty: returnedByItem.get(String(item.id)) ?? 0,
    })),
  };
}

export function validateReturnSelections(
  order: OrderForReturn,
  selections: Record<string, number>,
): ReturnLineInput[] {
  const lines: ReturnLineInput[] = [];

  for (const item of order.items) {
    const qty = Number(selections[item.id] ?? 0);
    if (qty <= 0) continue;

    const remaining = item.purchasedQty - item.returnedQty;
    if (qty > remaining) {
      throw new Error(
        remaining <= 0
          ? `"${item.name}" has no remaining quantity to return.`
          : `"${item.name}" can only return ${remaining} more (requested ${qty}).`,
      );
    }

    lines.push({
      orderItemId: item.id,
      productId: item.productId,
      sku: item.sku,
      name: item.name,
      unitPrice: item.unitPrice,
      quantity: qty,
    });
  }

  if (lines.length === 0) {
    throw new Error("Select at least one item to return.");
  }

  return lines;
}

export function calculateRefundAmount(lines: ReturnLineInput[]): number {
  return lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
}

export async function processReturn(input: {
  storeId: string;
  orderId: string;
  reason: string;
  lines: ReturnLineInput[];
  processedByUserId: string;
}): Promise<string> {
  const amount = calculateRefundAmount(input.lines);

  await supabase.from("profiles").upsert({ id: input.processedByUserId }, { onConflict: "id" });

  const { data: inserted, error } = await supabase
    .from("returns")
    .insert({
      store_id: input.storeId,
      order_id: input.orderId,
      processed_by_user_id: input.processedByUserId,
      reason: input.reason.trim() || "Customer return",
      amount,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  if (!inserted?.id) throw new Error("Return created but missing id.");

  const returnId = String(inserted.id);
  const itemsPayload = input.lines.map((line) => ({
    return_id: returnId,
    store_id: input.storeId,
    order_item_id: line.orderItemId,
    product_id: line.productId,
    product_name: line.name,
    unit_price: line.unitPrice,
    quantity: line.quantity,
    line_total: line.unitPrice * line.quantity,
  }));

  const { error: itemsError } = await supabase.from("return_items").insert(itemsPayload);
  if (itemsError && !itemsError.message.toLowerCase().includes("return_items")) {
    throw new Error(itemsError.message);
  }

  await restoreStockForReturn(input.storeId, input.lines);
  return returnId;
}

export async function listReturns(storeId: string): Promise<ReturnListRow[]> {
  const { data: returns, error } = await supabase
    .from("returns")
    .select("id, order_id, reason, amount, created_at")
    .eq("store_id", storeId)
    .order("created_at", { ascending: false })
    .limit(120);

  if (error) throw new Error(error.message);
  if (!returns?.length) return [];

  const returnIds = returns.map((row) => String(row.id));
  const orderIds = returns.map((row) => String(row.order_id));

  const itemCounts = new Map<string, number>();
  const { data: returnItems } = await supabase
    .from("return_items")
    .select("return_id, quantity")
    .eq("store_id", storeId)
    .in("return_id", returnIds);

  if (returnItems?.length) {
    returnItems.forEach((row) => {
      const key = String(row.return_id);
      itemCounts.set(key, (itemCounts.get(key) ?? 0) + Number(row.quantity ?? 0));
    });
  } else {
    const { data: orderItems } = await supabase
      .from("order_items")
      .select("order_id, quantity")
      .eq("store_id", storeId)
      .in("order_id", orderIds);
    const orderTotals = new Map<string, number>();
    (orderItems ?? []).forEach((row) => {
      const key = String(row.order_id);
      orderTotals.set(key, (orderTotals.get(key) ?? 0) + Number(row.quantity ?? 0));
    });
    returns.forEach((row) => {
      itemCounts.set(String(row.id), orderTotals.get(String(row.order_id)) ?? 1);
    });
  }

  const orderNumbers = new Map<string, string>();
  const { data: orders } = await supabase
    .from("orders")
    .select("id, order_number")
    .eq("store_id", storeId)
    .in("id", orderIds);
  (orders ?? []).forEach((row) => {
    orderNumbers.set(String(row.id), String(row.order_number));
  });

  return returns.map((row) => ({
    id: String(row.id),
    orderId: String(row.order_id),
    orderNumber: orderNumbers.get(String(row.order_id)) ?? String(row.order_id).slice(0, 8),
    reason: String(row.reason ?? ""),
    amount: Number(row.amount ?? 0),
    createdAt: String(row.created_at),
    itemCount: itemCounts.get(String(row.id)) ?? 0,
  }));
}

export async function getReturnDetail(storeId: string, returnId: string): Promise<ReturnDetail | null> {
  const { data: row, error } = await supabase
    .from("returns")
    .select("id, order_id, reason, amount, created_at")
    .eq("store_id", storeId)
    .eq("id", returnId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!row) return null;

  const { data: order } = await supabase
    .from("orders")
    .select("order_number")
    .eq("store_id", storeId)
    .eq("id", row.order_id)
    .maybeSingle();

  const { data: items, error: itemsError } = await supabase
    .from("return_items")
    .select("id, product_name, unit_price, quantity, line_total")
    .eq("store_id", storeId)
    .eq("return_id", row.id);

  if (itemsError && !itemsError.message.toLowerCase().includes("return_items")) {
    throw new Error(itemsError.message);
  }

  const mappedItems = (items ?? []).map((item) => ({
    id: String(item.id),
    name: String(item.product_name),
    quantity: Number(item.quantity ?? 0),
    unitPrice: Number(item.unit_price ?? 0),
    lineTotal: Number(item.line_total ?? 0),
  }));

  return {
    id: String(row.id),
    orderId: String(row.order_id),
    orderNumber: order?.order_number ? String(order.order_number) : String(row.order_id).slice(0, 8),
    reason: String(row.reason ?? ""),
    amount: Number(row.amount ?? 0),
    createdAt: String(row.created_at),
    itemCount: mappedItems.reduce((sum, item) => sum + item.quantity, 0),
    items: mappedItems,
  };
}

export const returnsService = {
  list: listReturns,
  getDetail: getReturnDetail,
  create: processReturn,
  searchOrder: lookupOrderForReturn,
};


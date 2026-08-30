import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "@/src/services/supabase";
import { restoreStockForReturn } from "./stock";
import type { OrderForReturn, ReturnDetail, ReturnLineInput, ReturnListRow } from "./types";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_RE.test(value.trim());
}

export function cleanReturnReason(reason?: string | null): string {
  if (!reason) return "Customer return";
  return reason.replace(/\[ITEMS:.*?\]/g, "").trim() || "Customer return";
}

async function fetchReturnedQtyByOrderItem(
  storeId: string,
  orderId: string,
  orderNumber?: string,
): Promise<{
  itemTotals: Map<string, number>;
  totalRefunded: number;
  returnCount: number;
}> {
  const itemTotals = new Map<string, number>();
  let totalRefunded = 0;
  let returnCount = 0;

  // 1. Check local persistent AsyncStorage registry
  try {
    const keysToCheck = [
      `omnipos:returned_items:${storeId}:${orderId}`,
      orderNumber ? `omnipos:returned_items:${storeId}:${orderNumber}` : null,
    ].filter(Boolean) as string[];

    for (const key of keysToCheck) {
      const raw = await AsyncStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          parsed.forEach((line: any) => {
            const qty = Number(line.quantity ?? 0);
            if (line.orderItemId) {
              const k = String(line.orderItemId);
              itemTotals.set(k, (itemTotals.get(k) ?? 0) + qty);
            }
            if (line.name) {
              const k = String(line.name).trim().toLowerCase();
              itemTotals.set(k, (itemTotals.get(k) ?? 0) + qty);
            }
            if (line.productId) {
              const k = String(line.productId);
              itemTotals.set(k, (itemTotals.get(k) ?? 0) + qty);
            }
          });
        }
      }
    }
  } catch {
    // ignore
  }

  // 2. Check Supabase returns & return_items
  try {
    let qb = supabase
      .from("returns")
      .select("id, amount, reason")
      .eq("store_id", storeId);

    if (orderNumber && orderId !== orderNumber) {
      qb = isUuid(orderId)
        ? qb.or(`order_id.eq.${orderId}`)
        : qb.eq("order_id", orderId);
    } else {
      qb = qb.eq("order_id", orderId);
    }

    const { data: returns, error: returnsError } = await qb;

    if (!returnsError && returns?.length) {
      returnCount = Math.max(returnCount, returns.length);
      totalRefunded = returns.reduce((sum, r) => sum + Number(r.amount ?? 0), 0);

      // Parse item manifest in reason if available
      returns.forEach((r) => {
        const reasonStr = String(r.reason ?? "");
        const match = reasonStr.match(/\[ITEMS:(.*?)\]/);
        if (match && match[1]) {
          try {
            const parsedLines = JSON.parse(match[1]);
            if (Array.isArray(parsedLines)) {
              parsedLines.forEach((line: any) => {
                const qty = Number(line.quantity ?? 0);
                if (line.orderItemId) {
                  const k = String(line.orderItemId);
                  itemTotals.set(k, (itemTotals.get(k) ?? 0) + qty);
                }
                if (line.name) {
                  const k = String(line.name).trim().toLowerCase();
                  itemTotals.set(k, (itemTotals.get(k) ?? 0) + qty);
                }
                if (line.productId) {
                  const k = String(line.productId);
                  itemTotals.set(k, (itemTotals.get(k) ?? 0) + qty);
                }
              });
            }
          } catch {
            // ignore JSON parse
          }
        }
      });

      const returnIds = returns.map((row) => String(row.id));
      const { data: items } = await supabase
        .from("return_items")
        .select("order_item_id, product_name, product_id, quantity")
        .eq("store_id", storeId)
        .in("return_id", returnIds);

      if (items?.length) {
        items.forEach((row) => {
          const qty = Number(row.quantity ?? 0);
          if (row.order_item_id) {
            const k = String(row.order_item_id);
            itemTotals.set(k, (itemTotals.get(k) ?? 0) + qty);
          }
          if (row.product_name) {
            const k = String(row.product_name).trim().toLowerCase();
            itemTotals.set(k, (itemTotals.get(k) ?? 0) + qty);
          }
          if (row.product_id) {
            const k = String(row.product_id);
            itemTotals.set(k, (itemTotals.get(k) ?? 0) + qty);
          }
        });
      }
    }
  } catch {
    // ignore
  }

  return { itemTotals, totalRefunded, returnCount };
}

export async function lookupOrderForReturn(storeId: string, ref: string): Promise<OrderForReturn | null> {
  const cleanRef = ref.trim().replace(/^\*|\*$/g, ""); // Strip any barcode asterisks
  if (!cleanRef) return null;

  try {
    let query = supabase
      .from("orders")
      .select("id, order_number, created_at, customer_name, status, total")
      .eq("store_id", storeId);

    query = isUuid(cleanRef) ? query.eq("id", cleanRef) : query.eq("order_number", cleanRef);

    const { data: order, error } = await query.maybeSingle();
    if (!error && order) {
      const orderStatus = String(order.status).toLowerCase();
      if (orderStatus === "voided") {
        throw new Error("This order was voided and cannot be returned.");
      }
      if (orderStatus === "refunded" || orderStatus === "returned") {
        throw new Error(`Order #${order.order_number} has already been fully refunded and returned.`);
      }

      const { data: items, error: itemsError } = await supabase
        .from("order_items")
        .select("id, product_id, sku, product_name, unit_price, quantity")
        .eq("store_id", storeId)
        .eq("order_id", order.id)
        .order("created_at", { ascending: true });

      if (itemsError) throw new Error(itemsError.message);
      if (!items || items.length === 0) {
        throw new Error("This order contains no items available for return.");
      }

      const { itemTotals, totalRefunded, returnCount } = await fetchReturnedQtyByOrderItem(
        storeId,
        String(order.id),
        String(order.order_number),
      );

      const orderTotal = Number(order.total ?? 0);
      const isAmountExhausted = orderTotal > 0 && totalRefunded >= orderTotal - 0.01;

      const orderItems = items.map((item) => {
        const keyId = String(item.id);
        const keyName = String(item.product_name).trim().toLowerCase();
        const keyProdId = item.product_id ? String(item.product_id) : "";

        const qtyById = itemTotals.get(keyId) ?? 0;
        const qtyByName = itemTotals.get(keyName) ?? 0;
        const qtyByProdId = keyProdId ? itemTotals.get(keyProdId) ?? 0 : 0;

        let retQty = Math.max(qtyById, qtyByName, qtyByProdId);
        if (retQty === 0 && isAmountExhausted) {
          retQty = Number(item.quantity ?? 0);
        }
        retQty = Math.min(Number(item.quantity ?? 0), retQty);

        return {
          id: String(item.id),
          productId: item.product_id ? String(item.product_id) : null,
          sku: item.sku ? String(item.sku) : null,
          name: String(item.product_name),
          unitPrice: Number(item.unit_price ?? 0),
          purchasedQty: Number(item.quantity ?? 0),
          returnedQty: retQty,
        };
      });

      const hasRemaining = orderItems.some((i) => i.purchasedQty - i.returnedQty > 0);
      if (!hasRemaining || isAmountExhausted) {
        throw new Error(
          `All items from receipt #${order.order_number} have already been returned and refunded (${returnCount} previous return${returnCount === 1 ? "" : "s"}).`
        );
      }

      return {
        id: String(order.id),
        orderNumber: String(order.order_number),
        createdAt: String(order.created_at),
        customerName: (order.customer_name as string | null) ?? null,
        items: orderItems,
      };
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("already been")) {
      throw err;
    }
    // try local SQLite fallback
  }

  // Fallback: check SQLite WatermelonDB
  try {
    const { database } = await import("@/src/database");
    const { Q } = await import("@nozbe/watermelondb");

    const localOrders = await database
      .get<any>("orders")
      .query(
        Q.where("store_id", storeId),
        Q.or(Q.where("order_number", cleanRef), Q.where("id", cleanRef), Q.where("remote_id", cleanRef))
      )
      .fetch();

    const matched = localOrders[0];
    if (matched) {
      const orderStatus = String(matched.status).toLowerCase();
      if (orderStatus === "refunded" || orderStatus === "returned") {
        throw new Error(`Order #${matched.orderNumber} has already been fully refunded and returned.`);
      }

      const localItems = await database
        .get<any>("order_items")
        .query(Q.where("order_id", matched.id))
        .fetch();

      const { itemTotals, totalRefunded } = await fetchReturnedQtyByOrderItem(
        storeId,
        matched.remoteId || matched.id,
        matched.orderNumber,
      );

      const orderTotal = Number(matched.total ?? 0);
      const isAmountExhausted = orderTotal > 0 && totalRefunded >= orderTotal - 0.01;

      const orderItems = localItems.map((item: any) => {
        const keyId = String(item.id);
        const keyName = String(item.productName).trim().toLowerCase();
        const keyProdId = item.productId ? String(item.productId) : "";

        const qtyById = itemTotals.get(keyId) ?? 0;
        const qtyByName = itemTotals.get(keyName) ?? 0;
        const qtyByProdId = keyProdId ? itemTotals.get(keyProdId) ?? 0 : 0;

        let retQty = Math.max(qtyById, qtyByName, qtyByProdId);
        if (retQty === 0 && isAmountExhausted) {
          retQty = Number(item.quantity ?? 0);
        }
        retQty = Math.min(Number(item.quantity ?? 0), retQty);

        return {
          id: item.id,
          productId: item.productId ?? null,
          sku: item.sku ?? null,
          name: item.productName,
          unitPrice: Number(item.unitPrice ?? 0),
          purchasedQty: Number(item.quantity ?? 0),
          returnedQty: retQty,
        };
      });

      const hasRemaining = orderItems.some((i: any) => i.purchasedQty - i.returnedQty > 0);
      if (!hasRemaining || isAmountExhausted) {
        throw new Error(`All items from receipt #${matched.orderNumber} have already been returned and refunded.`);
      }

      return {
        id: matched.id,
        orderNumber: matched.orderNumber,
        createdAt: new Date(matched.createdAt).toISOString(),
        customerName: matched.customerName ?? null,
        items: orderItems,
      };
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("already been")) {
      throw err;
    }
  }

  return null;
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
          ? `"${item.name}" has already been fully returned and refunded.`
          : `"${item.name}" only has ${remaining} unit${remaining === 1 ? "" : "s"} remaining to return (requested ${qty}).`,
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
    throw new Error("Select at least one item and quantity to return.");
  }

  return lines;
}

export function calculateRefundAmount(lines: ReturnLineInput[]): number {
  return lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
}

export async function processReturn(input: {
  storeId: string;
  orderId: string;
  orderNumber?: string;
  reason: string;
  lines: ReturnLineInput[];
  processedByUserId: string;
}): Promise<string> {
  const amount = calculateRefundAmount(input.lines);

  await supabase.from("profiles").upsert({ id: input.processedByUserId }, { onConflict: "id" });

  const manifest = JSON.stringify(
    input.lines.map((l) => ({
      orderItemId: l.orderItemId,
      productId: l.productId,
      name: l.name,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
    }))
  );

  const cleanUserReason = input.reason.trim() || "Customer return";
  const fullReasonWithManifest = `${cleanUserReason} [ITEMS:${manifest}]`;

  const { data: inserted, error } = await supabase
    .from("returns")
    .insert({
      store_id: input.storeId,
      order_id: input.orderId,
      processed_by_user_id: input.processedByUserId,
      reason: fullReasonWithManifest,
      amount,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  if (!inserted?.id) throw new Error("Return created but missing id.");

  const returnId = String(inserted.id);

  // Store in return_items
  const itemsPayload = input.lines.map((line) => ({
    return_id: returnId,
    store_id: input.storeId,
    order_item_id: isUuid(line.orderItemId) ? line.orderItemId : null,
    product_id: line.productId && isUuid(line.productId) ? line.productId : null,
    product_name: line.name,
    unit_price: line.unitPrice,
    quantity: line.quantity,
    line_total: line.unitPrice * line.quantity,
  }));

  try {
    await supabase.from("return_items").insert(itemsPayload);
  } catch {
    // Handled by manifest
  }

  // Save to local persistent AsyncStorage registry
  try {
    const keysToSave = [
      `omnipos:returned_items:${input.storeId}:${input.orderId}`,
      input.orderNumber ? `omnipos:returned_items:${input.storeId}:${input.orderNumber}` : null,
    ].filter(Boolean) as string[];

    for (const key of keysToSave) {
      const raw = await AsyncStorage.getItem(key);
      const prev: any[] = raw ? JSON.parse(raw) : [];
      const updated = [...prev, ...input.lines];
      await AsyncStorage.setItem(key, JSON.stringify(updated));
    }
  } catch {
    // ignore
  }

  await restoreStockForReturn(input.storeId, input.lines);

  // Update order status in Supabase and local SQLite to prevent reuse
  try {
    const { data: orderData } = await supabase
      .from("orders")
      .select("id, total")
      .eq("id", input.orderId)
      .maybeSingle();

    const { totalRefunded } = await fetchReturnedQtyByOrderItem(
      input.storeId,
      input.orderId,
      input.orderNumber,
    );
    const orderTotal = Number(orderData?.total ?? 0);
    const isFullyRefunded = orderTotal > 0 && totalRefunded >= orderTotal - 0.01;

    const nextStatus = isFullyRefunded ? "refunded" : "partially_refunded";

    await supabase
      .from("orders")
      .update({ status: nextStatus })
      .eq("id", input.orderId);

    // Also update local WatermelonDB order
    const { database } = await import("@/src/database");
    const { Q } = await import("@nozbe/watermelondb");
    const localOrderList = await database
      .get<any>("orders")
      .query(Q.or(Q.where("id", input.orderId), Q.where("remote_id", input.orderId)))
      .fetch();

    if (localOrderList.length > 0) {
      await database.write(async () => {
        for (const lo of localOrderList) {
          await lo.update((rec: any) => {
            rec.status = nextStatus;
          });
        }
      });
    }
  } catch {
    // ignore non-critical status update failure
  }

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
    returns.forEach((row) => {
      const reasonStr = String(row.reason ?? "");
      const match = reasonStr.match(/\[ITEMS:(.*?)\]/);
      if (match && match[1]) {
        try {
          const parsed = JSON.parse(match[1]);
          if (Array.isArray(parsed)) {
            const count = parsed.reduce((sum: number, l: any) => sum + Number(l.quantity ?? 0), 0);
            itemCounts.set(String(row.id), count);
          }
        } catch {
          // ignore
        }
      }
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
    reason: cleanReturnReason(row.reason),
    amount: Number(row.amount ?? 0),
    createdAt: String(row.created_at),
    itemCount: itemCounts.get(String(row.id)) ?? 1,
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

  let mappedItems = (items ?? []).map((item) => ({
    id: String(item.id),
    name: String(item.product_name),
    quantity: Number(item.quantity ?? 0),
    unitPrice: Number(item.unit_price ?? 0),
    lineTotal: Number(item.line_total ?? 0),
  }));

  if (mappedItems.length === 0) {
    const reasonStr = String(row.reason ?? "");
    const match = reasonStr.match(/\[ITEMS:(.*?)\]/);
    if (match && match[1]) {
      try {
        const parsed = JSON.parse(match[1]);
        if (Array.isArray(parsed)) {
          mappedItems = parsed.map((item: any, idx: number) => ({
            id: `line-${idx}`,
            name: String(item.name),
            quantity: Number(item.quantity ?? 0),
            unitPrice: Number(item.unitPrice ?? 0),
            lineTotal: Number(item.unitPrice ?? 0) * Number(item.quantity ?? 0),
          }));
        }
      } catch {
        // ignore
      }
    }
  }

  return {
    id: String(row.id),
    orderId: String(row.order_id),
    orderNumber: order?.order_number ? String(order.order_number) : String(row.order_id).slice(0, 8),
    reason: cleanReturnReason(row.reason),
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


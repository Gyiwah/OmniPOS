import { storage } from "@/src/core/platform";
import { uuidv7 } from "@/src/core/ids";
import { database } from "@/src/database";
import { Q } from "@nozbe/watermelondb";
import type Order from "@/src/database/models/Order";
import type OrderItem from "@/src/database/models/OrderItem";
import { supabase } from "@/src/services/supabase";
import { restoreStockForReturn } from "./stock";
import type { OrderForReturn, ReturnDetail, ReturnLineInput, ReturnListRow } from "./types";
import { usingLaravel } from "@/src/core/api/config";
import { enqueueChange } from "@/src/sync/enqueue";

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

  // 1. Check local persistent storage registry
  try {
    const keysToCheck = [
      `omnipos:returned_items:${storeId}:${orderId}`,
      orderNumber ? `omnipos:returned_items:${storeId}:${orderNumber}` : null,
    ].filter(Boolean) as string[];

    for (const key of keysToCheck) {
      const raw = await storage.getItem(key);
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

  // 2. Check Supabase returns & return_items if available
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

  // 1. Primary Source: Check local SQLite WatermelonDB FIRST for instant 100% offline lookup
  try {
    const localOrders = await database
      .get<Order>("orders")
      .query(
        Q.where("store_id", storeId),
        Q.or(Q.where("order_number", cleanRef), Q.where("id", cleanRef), Q.where("remote_id", cleanRef)),
      )
      .fetch();

    const matched = localOrders[0];
    if (matched) {
      const orderStatus = String(matched.status).toLowerCase();
      if (orderStatus === "refunded" || orderStatus === "returned") {
        throw new Error(`Order #${matched.orderNumber} has already been fully refunded and returned.`);
      }

      const localItems = await database
        .get<OrderItem>("order_items")
        .query(Q.where("order_id", matched.id))
        .fetch();

      const { itemTotals, totalRefunded } = await fetchReturnedQtyByOrderItem(
        storeId,
        matched.remoteId || matched.id,
        matched.orderNumber,
      );

      const orderTotal = Number(matched.total ?? 0);
      const isAmountExhausted = orderTotal > 0 && totalRefunded >= orderTotal - 0.01;

      const orderItems = localItems.map((item) => {
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

      const hasRemaining = orderItems.some((i) => i.purchasedQty - i.returnedQty > 0);
      if (!hasRemaining || isAmountExhausted) {
        throw new Error(`All items from receipt #${matched.orderNumber} have already been returned and refunded.`);
      }

      return {
        id: matched.id,
        orderNumber: matched.orderNumber,
        createdAt: new Date(Number(matched.createdAt)).toISOString(),
        customerName: matched.customerName ?? null,
        items: orderItems,
      };
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("already been")) {
      throw err;
    }
  }

  // 2. Secondary fallback: check remote Supabase if online
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
          `All items from receipt #${order.order_number} have already been returned and refunded (${returnCount} previous return${returnCount === 1 ? "" : "s"}).`,
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
  const localReturnId = uuidv7();

  const manifest = JSON.stringify(
    input.lines.map((l) => ({
      orderItemId: l.orderItemId,
      productId: l.productId,
      name: l.name,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
    })),
  );

  const cleanUserReason = input.reason.trim() || "Customer return";
  const fullReasonWithManifest = `${cleanUserReason} [ITEMS:${manifest}]`;

  // 1. Save to local persistent storage registry FIRST
  try {
    const keysToSave = [
      `omnipos:returned_items:${input.storeId}:${input.orderId}`,
      input.orderNumber ? `omnipos:returned_items:${input.storeId}:${input.orderNumber}` : null,
    ].filter(Boolean) as string[];

    for (const key of keysToSave) {
      const raw = await storage.getItem(key);
      const prev: any[] = raw ? JSON.parse(raw) : [];
      const updated = [...prev, ...input.lines];
      await storage.setItem(key, JSON.stringify(updated));
    }

    // Save full return object to local return history list
    const historyKey = `omnipos:return_records:${input.storeId}`;
    const rawHist = await storage.getItem(historyKey);
    const prevHist: ReturnListRow[] = rawHist ? JSON.parse(rawHist) : [];
    const newRecord: ReturnListRow = {
      id: localReturnId,
      orderId: input.orderId,
      orderNumber: input.orderNumber || input.orderId.slice(0, 8),
      reason: cleanUserReason,
      amount,
      createdAt: new Date().toISOString(),
      itemCount: input.lines.reduce((s, l) => s + l.quantity, 0),
    };
    await storage.setItem(historyKey, JSON.stringify([newRecord, ...prevHist]));
  } catch {
    // ignore local storage error
  }

  // 2. Restore stock in local WatermelonDB
  await restoreStockForReturn(input.storeId, input.lines);

  // 3. Update order status in local WatermelonDB
  try {
    const { itemTotals, totalRefunded } = await fetchReturnedQtyByOrderItem(
      input.storeId,
      input.orderId,
      input.orderNumber,
    );

    const localOrderList = await database
      .get<Order>("orders")
      .query(Q.or(Q.where("id", input.orderId), Q.where("remote_id", input.orderId)))
      .fetch();

    if (localOrderList.length > 0) {
      const orderTotal = Number(localOrderList[0].total ?? 0);
      const isFullyRefunded = orderTotal > 0 && totalRefunded >= orderTotal - 0.01;
      const nextStatus = isFullyRefunded ? "refunded" : "partially_refunded";

      await database.write(async () => {
        for (const lo of localOrderList) {
          await lo.update((rec) => {
            rec.status = nextStatus;
          });
        }
      });
    }
  } catch {
    // ignore
  }

  // 4. Get it to the server.
  if (usingLaravel) {
    /*
     * Queued, not posted.
     *
     * A refund is money that has already left the drawer, so it must survive
     * the app being closed, the network being down, and the phone being
     * restarted. The outbox gives it the same delivery guarantee a sale has:
     * retried until accepted, idempotent on the queue row's id, and surfaced as
     * a conflict rather than dropped if the server refuses it — which it will if
     * another till has already refunded these items.
     */
    await enqueueChange({
      storeId: input.storeId,
      entity: "returns",
      operation: "upsert",
      recordId: localReturnId,
      payload: {
        id: localReturnId,
        order_id: input.orderId,
        processed_by_user_id: input.processedByUserId,
        reason: fullReasonWithManifest,
        amount,
        refund_method: "cash",
        client_created_at: new Date().toISOString(),
        items: input.lines.map((line) => ({
          id: uuidv7(),
          order_item_id: line.orderItemId,
          product_id: line.productId ?? null,
          product_name: line.name,
          unit_price: line.unitPrice,
          quantity: line.quantity,
          line_total: line.unitPrice * line.quantity,
          restock: true,
        })),
      },
    });
  } else {
    try {
      await supabase.from("profiles").upsert({ id: input.processedByUserId }, { onConflict: "id" });

      const { data: inserted, error } = await supabase
        .from("returns")
        .insert({
          id: localReturnId,
          store_id: input.storeId,
          order_id: input.orderId,
          processed_by_user_id: input.processedByUserId,
          reason: fullReasonWithManifest,
          amount,
        })
        .select("id")
        .single();

      if (!error && inserted?.id) {
        const itemsPayload = input.lines.map((line) => ({
          return_id: String(inserted.id),
          store_id: input.storeId,
          order_item_id: isUuid(line.orderItemId) ? line.orderItemId : null,
          product_id: line.productId && isUuid(line.productId) ? line.productId : null,
          product_name: line.name,
          unit_price: line.unitPrice,
          quantity: line.quantity,
          line_total: line.unitPrice * line.quantity,
        }));

        await supabase.from("return_items").insert(itemsPayload);
      }
    } catch {
      // Offline mode: Return is recorded locally and stock restored safely
    }
  }

  return localReturnId;
}

export async function listReturns(storeId: string): Promise<ReturnListRow[]> {
  try {
    const { data: returns, error } = await supabase
      .from("returns")
      .select("id, order_id, reason, amount, created_at")
      .eq("store_id", storeId)
      .order("created_at", { ascending: false })
      .limit(120);

    if (!error && returns && returns.length > 0) {
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

      const list = returns.map((row) => ({
        id: String(row.id),
        orderId: String(row.order_id),
        orderNumber: orderNumbers.get(String(row.order_id)) ?? String(row.order_id).slice(0, 8),
        reason: cleanReturnReason(row.reason),
        amount: Number(row.amount ?? 0),
        createdAt: String(row.created_at),
        itemCount: itemCounts.get(String(row.id)) ?? 1,
      }));

      // Cache locally for offline viewing
      void storage.setItem(`omnipos:return_records:${storeId}`, JSON.stringify(list));
      return list;
    }
  } catch {
    // offline fallback below
  }

  // Fallback: Read from local platform-storage cache
  try {
    const rawHist = await storage.getItem(`omnipos:return_records:${storeId}`);
    if (rawHist) {
      const parsed: ReturnListRow[] = JSON.parse(rawHist);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    }
  } catch {
    // ignore
  }

  return [];
}

export async function getReturnDetail(storeId: string, returnId: string): Promise<ReturnDetail | null> {
  try {
    const { data: row, error } = await supabase
      .from("returns")
      .select("id, order_id, reason, amount, created_at")
      .eq("store_id", storeId)
      .eq("id", returnId)
      .maybeSingle();

    if (!error && row) {
      let itemsList: ReturnDetail["items"] = [];
      const { data: items } = await supabase
        .from("return_items")
        .select("id, order_item_id, product_id, product_name, unit_price, quantity")
        .eq("store_id", storeId)
        .eq("return_id", returnId);

      if (items?.length) {
        itemsList = items.map((i: any) => ({
          id: String(i.id || i.order_item_id || ""),
          name: String(i.product_name),
          unitPrice: Number(i.unit_price ?? 0),
          quantity: Number(i.quantity ?? 0),
          lineTotal: Number(i.unit_price ?? 0) * Number(i.quantity ?? 0),
        }));
      }

      return {
        id: String(row.id),
        orderId: String(row.order_id),
        orderNumber: String(row.order_id).slice(0, 8),
        reason: cleanReturnReason(row.reason),
        amount: Number(row.amount ?? 0),
        createdAt: String(row.created_at),
        itemCount: itemsList.length,
        items: itemsList,
      };
    }
  } catch {
    // offline fallback below
  }

  // Fallback to local cached list
  try {
    const rawHist = await storage.getItem(`omnipos:return_records:${storeId}`);
    if (rawHist) {
      const parsed: ReturnListRow[] = JSON.parse(rawHist);
      const found = parsed.find((r) => r.id === returnId);
      if (found) {
        return {
          id: found.id,
          orderId: found.orderId,
          orderNumber: found.orderNumber,
          reason: found.reason,
          amount: found.amount,
          createdAt: found.createdAt,
          itemCount: found.itemCount,
          items: [],
        };
      }
    }
  } catch {
    // ignore
  }

  return null;
}

export const returnsService = {
  list: listReturns,
  detail: getReturnDetail,
  lookupOrder: lookupOrderForReturn,
  process: processReturn,
};


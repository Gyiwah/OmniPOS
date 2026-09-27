import { storage } from "@/src/core/platform";
import { uuidv7 } from "@/src/core/ids";
import { database } from "@/src/database";
import { Q } from "@nozbe/watermelondb";
import type Order from "@/src/database/models/Order";
import type OrderItem from "@/src/database/models/OrderItem";
import { supabase } from "@/src/services/supabase";
import { restoreStockForReturn } from "./stock";
import type {
  OrderForReturn,
  RefundMethod,
  ReturnDetail,
  ReturnLineInput,
  ReturnListRow,
} from "./types";
import { usingLaravel } from "@/src/core/api/config";
import * as laravelReturns from "./laravelReturns";
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

async function supabase_lookupOrderForReturn(storeId: string, ref: string): Promise<OrderForReturn | null> {
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
        paymentMethod: matched.paymentMethod ?? null,
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
      .select("id, order_number, created_at, customer_name, status, total, payment_method")
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
        paymentMethod: (order.payment_method as string | null) ?? null,
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
  /**
   * How the money goes back. Required rather than defaulted: the backend books
   * the refund as a negative payment on this method, so a caller that forgets
   * it would quietly charge every refund against the cash drawer.
   */
  refundMethod: RefundMethod;
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
    await storage.setItem(`omnipos:return_detail:${input.storeId}:${localReturnId}`, JSON.stringify({
      ...newRecord,
      items: input.lines.map((line, index) => ({
        id: `${localReturnId}-${index}`,
        name: line.name,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        lineTotal: line.unitPrice * line.quantity,
      })),
    } satisfies ReturnDetail));
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

      /*
       * Accumulated from the refunds this till has actually processed, not
       * from totalRefunded above — that comes from a Supabase query which
       * returns nothing on a Laravel build, so it is always zero here. The
       * visible symptom was a fully refunded sale marked "partially_refunded".
       *
       * `amount` is this refund, computed locally moments ago, so the figure
       * is right whether or not anything can be reached.
       */
      const alreadyRefunded = Number(localOrderList[0].refundedAmount ?? 0);
      const refundedSoFar = Math.min(
        Math.max(alreadyRefunded, totalRefunded) + amount,
        orderTotal > 0 ? orderTotal : Number.MAX_SAFE_INTEGER,
      );

      const isFullyRefunded = orderTotal > 0 && refundedSoFar >= orderTotal - 0.01;
      const nextStatus = isFullyRefunded ? "refunded" : "partially_refunded";

      await database.write(async () => {
        for (const lo of localOrderList) {
          await lo.update((rec) => {
            rec.status = nextStatus;
            /*
             * For the drawer. Expected cash is computed by walking local
             * orders, and with nothing recorded here a refund never left that
             * figure — a correct till reported itself short by whatever had
             * been handed back.
             */
            rec.refundedAmount = refundedSoFar;
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
        /*
         * The method the cashier picked, not an assumption.
         *
         * The server books this as a negative payment row on this method. When
         * every refund from a phone claimed to be cash, a mobile money refund
         * reduced the drawer's expected cash by money that had never left it,
         * and the shift counted over by the refund amount.
         *
         * 'momo' is this app's spelling; Payment::canonicalMethod maps it to
         * the schema's 'mobile_money' on arrival.
         */
        refund_method: input.refundMethod,
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

      const row = {
        id: localReturnId,
        store_id: input.storeId,
        order_id: input.orderId,
        processed_by_user_id: input.processedByUserId,
        reason: fullReasonWithManifest,
        amount,
        // Recorded here too, so the two transports agree on what a refund is.
        // Supabase gained this column in 014_returns_refund_method.sql.
        refund_method: input.refundMethod,
      };

      let { data: inserted, error } = await supabase
        .from("returns")
        .insert(row)
        .select("id")
        .single();

      /*
       * Fallback for a project that has not run 014 yet, in the same shape the
       * product sync uses for its own late columns. PostgREST refuses the whole
       * insert over one unknown column, and the catch below would swallow it —
       * so the refund would be paid out at the counter and never reach the
       * server at all. Losing the method is bad; losing the refund is worse.
       */
      if (error && error.message.toLowerCase().includes("refund_method")) {
        const legacyRow: Record<string, unknown> = { ...row };
        delete legacyRow.refund_method;
        const retry = await supabase.from("returns").insert(legacyRow).select("id").single();
        inserted = retry.data;
        error = retry.error;
      }

      if (!error && inserted?.id) {
        const remoteReturnId = String(inserted.id);
        const itemsPayload = input.lines.map((line) => ({
          return_id: remoteReturnId,
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

async function supabase_listReturns(storeId: string): Promise<ReturnListRow[]> {
  try {
    const pageSize = 1000;
    const returns: Array<{ id: string; order_id: string; reason: string; amount: number; created_at: string }> = [];
    let offset = 0;
    while (true) {
      const { data, error } = await supabase
        .from("returns")
        .select("id, order_id, reason, amount, created_at")
        .eq("store_id", storeId)
        .order("created_at", { ascending: false })
        .range(offset, offset + pageSize - 1)
        .returns<typeof returns>();
      if (error) throw error;
      const page = data ?? [];
      returns.push(...page);
      if (page.length < pageSize) break;
      offset += pageSize;
    }

    const itemCounts = new Map<string, number>();
    const orderNumbers = new Map<string, string>();
    for (let start = 0; start < returns.length; start += 100) {
      const batch = returns.slice(start, start + 100);
      const returnIds = batch.map((row) => String(row.id));
      const orderIds = [...new Set(batch.map((row) => String(row.order_id)))];
      const [{ data: returnItems, error: returnItemsError }, { data: orders, error: ordersError }] = await Promise.all([
        supabase
          .from("return_items")
          .select("return_id, quantity")
          .eq("store_id", storeId)
          .in("return_id", returnIds),
        supabase
          .from("orders")
          .select("id, order_number")
          .eq("store_id", storeId)
          .in("id", orderIds),
      ]);
      if (returnItemsError) throw returnItemsError;
      if (ordersError) throw ordersError;

      for (const row of returnItems ?? []) {
        const key = String(row.return_id);
        itemCounts.set(key, (itemCounts.get(key) ?? 0) + Number(row.quantity ?? 0));
      }
      for (const row of orders ?? []) orderNumbers.set(String(row.id), String(row.order_number));
    }

    const list = returns.map((row) => ({
        id: String(row.id),
        orderId: String(row.order_id),
        orderNumber: orderNumbers.get(String(row.order_id)) ?? String(row.order_id).slice(0, 8),
        reason: cleanReturnReason(row.reason),
        amount: Number(row.amount ?? 0),
        createdAt: String(row.created_at),
        itemCount: itemCounts.get(String(row.id)) ?? 1,
      }));

    const rawHist = await storage.getItem(`omnipos:return_records:${storeId}`);
    const cached: ReturnListRow[] = rawHist ? JSON.parse(rawHist) : [];
    const merged = new Map(cached.map((row) => [row.id, row]));
    for (const row of list) merged.set(row.id, row);
    const mergedRows = [...merged.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    void storage.setItem(`omnipos:return_records:${storeId}`, JSON.stringify(mergedRows));
    return mergedRows;
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

async function supabase_getReturnDetail(storeId: string, returnId: string): Promise<ReturnDetail | null> {
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

      const { data: order } = await supabase
        .from("orders")
        .select("order_number")
        .eq("store_id", storeId)
        .eq("id", row.order_id)
        .maybeSingle();

      return {
        id: String(row.id),
        orderId: String(row.order_id),
        orderNumber: order?.order_number ? String(order.order_number) : String(row.order_id).slice(0, 8),
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

  try {
    const cachedDetail = await storage.getItem(`omnipos:return_detail:${storeId}:${returnId}`);
    if (cachedDetail) return JSON.parse(cachedDetail) as ReturnDetail;
  } catch {
    // Continue with the summary cache when no full local detail was saved.
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

/*
 * Reads pick a backend once, here.
 *
 * Eligibility is the reason these are not shared: a till only knows the returns
 * it processed itself, so the Supabase version computed from local knowledge
 * that goes stale as soon as another terminal refunds the same sale. The server
 * counts every return ever recorded.
 */
export const lookupOrderForReturn = usingLaravel
  ? laravelReturns.lookupOrderForReturn
  : supabase_lookupOrderForReturn;

export const listReturns = usingLaravel ? laravelReturns.listReturns : supabase_listReturns;

export const getReturnDetail = usingLaravel ? laravelReturns.getReturnDetail : supabase_getReturnDetail;

export const returnsService = {
  list: listReturns,
  detail: getReturnDetail,
  lookupOrder: lookupOrderForReturn,
  process: processReturn,
};


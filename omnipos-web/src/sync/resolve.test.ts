import { beforeEach, describe, expect, it } from "vitest";

import { clearLocalData, db, type SyncOperation } from "@/db/schema";
import { isUuid } from "@/core/uuidv7";
import { completeSale } from "@/features/pos/checkout";
import { discardOperation, reissueOrder, retryOperation } from "./resolve";
import { applyChangesForTest } from "./engine";
import type { CartLine } from "@/features/pos/cart";

const STORE = "0192aaaa-0000-7000-8000-000000000001";
const NO_TAX = { taxRate: 0, vatRate: 0, serviceRate: 0 };

const line = (over: Partial<CartLine> = {}): CartLine => ({
  id: "l1",
  productId: "0192aaaa-0000-7000-8000-00000000000a",
  name: "Widget",
  sku: "SKU-1",
  barcode: null,
  unitPrice: 1000,
  unitCost: 600,
  quantity: 2,
  availableStock: 10,
  ...over,
});

async function seedProduct(stock = 20) {
  await db.products.put({
    id: "0192aaaa-0000-7000-8000-00000000000a",
    store_id: STORE,
    category_id: null,
    name: "Widget",
    sku: "SKU-1",
    barcode: null,
    price: "10.00",
    cost_price: "6.00",
    stock,
    reorder_level: 5,
    image_url: null,
    tags: [],
    is_active: true,
    updated_at: new Date().toISOString(),
    search_key: "widget sku-1",
  });
}

/** Put a completed sale into the state a server rejection leaves it in. */
async function makeConflictedSale(orderNumber: string): Promise<SyncOperation> {
  await seedProduct();

  const order = await completeSale({
    storeId: STORE,
    lines: [line()],
    discountMode: "percentage",
    discountValue: 0,
    rates: NO_TAX,
    tenders: [{ method: "cash", amount: 2000 }],
    customer: null,
    registerShiftId: null,
    orderNumber,
  });

  const op = (await db.outbox.toArray())[0];

  await db.outbox.update(op.operation_id, {
    status: "conflict",
    last_error: `Order number [${orderNumber}] already exists in this store.`,
  });
  await db.orders.update(order.id, { _state: "conflict" });

  return (await db.outbox.get(op.operation_id))!;
}

describe("resolving a rejected sale", () => {
  beforeEach(async () => {
    await clearLocalData();
  });

  /**
   * The rule the whole feature rests on.
   *
   * The server records every operation_id it has seen, rejections included.
   * Re-pushing a corrected payload under the original id hits the idempotency
   * short-circuit: the server answers "duplicate" from the stored conflict
   * result and applies nothing, while the client deletes the outbox row
   * believing it succeeded. The sale would vanish — money taken, receipt
   * printed, nothing on the books — and it would look like success.
   */
  it("re-issuing mints a NEW operation_id so the server cannot replay the rejection", async () => {
    const conflicted = await makeConflictedSale("OM-20260831-0001");

    const { from, to } = await reissueOrder(conflicted.operation_id);

    const outbox = await db.outbox.toArray();
    expect(outbox).toHaveLength(1);

    const replacement = outbox[0];
    expect(replacement.operation_id).not.toBe(conflicted.operation_id);
    expect(isUuid(replacement.operation_id)).toBe(true);

    // The original id must be gone, not merely superseded.
    expect(await db.outbox.get(conflicted.operation_id)).toBeUndefined();

    expect(from).toBe("OM-20260831-0001");
    expect(to).not.toBe(from);
  });

  it("re-issuing keeps the record id and only changes the receipt number", async () => {
    const conflicted = await makeConflictedSale("OM-20260831-0001");
    const before = await db.orders.get(conflicted.record_id);

    const { to } = await reissueOrder(conflicted.operation_id);
    const after = await db.orders.get(conflicted.record_id);
    const queued = (await db.outbox.toArray())[0];

    // Only the human-facing number collided; the UUID identity never did.
    expect(after!.id).toBe(before!.id);
    expect(after!.order_number).toBe(to);
    expect(after!.total).toBe(before!.total);
    expect(after!._state).toBe("pending");

    // The queued payload must carry the new number, or the same clash recurs.
    expect((queued.payload as { order_number: string }).order_number).toBe(to);
    expect(queued.status).toBe("pending");
    expect(queued.attempts).toBe(0);
    expect(queued.last_error).toBeNull();
  });

  it("re-issuing preserves the money and the lines exactly", async () => {
    const conflicted = await makeConflictedSale("OM-20260831-0001");
    const before = await db.orders.get(conflicted.record_id);

    await reissueOrder(conflicted.operation_id);
    const after = await db.orders.get(conflicted.record_id);

    expect(after!.total).toBe("20.00");
    expect(after!.amount_paid).toBe("20.00");
    expect(after!.items).toEqual(before!.items);
    expect(after!.payments).toEqual(before!.payments);
  });

  it("retrying also mints a new operation_id and leaves the payload untouched", async () => {
    const conflicted = await makeConflictedSale("OM-20260831-0007");

    await retryOperation(conflicted.operation_id);

    const queued = (await db.outbox.toArray())[0];
    expect(queued.operation_id).not.toBe(conflicted.operation_id);
    expect(queued.payload).toEqual(conflicted.payload);
    expect(queued.status).toBe("pending");

    const order = await db.orders.get(conflicted.record_id);
    expect(order!._state).toBe("pending");
  });

  /**
   * Discarding removes the operation but keeps the sale on the device. Somebody
   * took money against it and may hold a receipt; erasing the evidence would
   * leave nothing to investigate.
   */
  it("discarding drops the operation but keeps the sale, marked as not booked", async () => {
    const conflicted = await makeConflictedSale("OM-20260831-0001");

    await discardOperation(conflicted.operation_id);

    expect(await db.outbox.count()).toBe(0);

    const order = await db.orders.get(conflicted.record_id);
    expect(order).toBeDefined();
    expect(order!._state).toBe("discarded");
    expect(order!.total).toBe("20.00");
  });

  /**
   * A manager on another device can book this sale from the server's stored
   * payload. When that happens the sale comes back through the changefeed, and
   * this till must stop showing it as needing a decision — otherwise a second
   * manager settles a sale that is already on the books.
   */
  it("clears a conflict once the server reports the record as applied", async () => {
    const conflicted = await makeConflictedSale("OM-20260831-0001");

    expect(await db.outbox.count()).toBe(1);
    expect((await db.orders.get(conflicted.record_id))!._state).toBe("conflict");

    // Simulate the pull that follows a manager booking it elsewhere.
    await applyChangesForTest([
      {
        entity: "orders",
        action: "upsert",
        record_id: conflicted.record_id,
        payload: {
          id: conflicted.record_id,
          order_number: "OM-20260831-0042",
          status: "completed",
          amount_paid: "20.00",
        },
      },
    ]);

    expect(await db.outbox.count()).toBe(0);

    const order = await db.orders.get(conflicted.record_id);
    // Reprinting must now show the number that is actually on the books.
    expect(order!.order_number).toBe("OM-20260831-0042");
    expect(order!._state).toBe("clean");
  });

  it("does not overwrite a sale this till has not pushed yet", async () => {
    await seedProduct();
    const order = await completeSale({
      storeId: STORE,
      lines: [line()],
      discountMode: "percentage",
      discountValue: 0,
      rates: NO_TAX,
      tenders: [{ method: "cash", amount: 2000 }],
      customer: null,
      registerShiftId: null,
      orderNumber: "OM-20260831-0050",
    });

    // A stray change for a record still queued locally must be ignored: the
    // cashier's own unsent work outranks it.
    await applyChangesForTest([
      {
        entity: "orders",
        action: "upsert",
        record_id: order.id,
        payload: { id: order.id, order_number: "OM-SERVER-9999", status: "completed" },
      },
    ]);

    const after = await db.orders.get(order.id);
    expect(after!.order_number).toBe("OM-20260831-0050");
    expect(after!._state).toBe("pending");
  });

  it("refuses to re-issue an operation that is no longer queued", async () => {
    await expect(reissueOrder("0192aaaa-0000-7000-8000-0000000000ff")).rejects.toThrow(/no longer queued/i);
  });

  it("discarding an operation that has already gone is a no-op, not an error", async () => {
    await expect(discardOperation("0192aaaa-0000-7000-8000-0000000000ff")).resolves.toBeUndefined();
  });

  it("two conflicts re-issued in turn get distinct receipt numbers", async () => {
    const first = await makeConflictedSale("OM-20260831-0001");
    const firstResult = await reissueOrder(first.operation_id);

    // A second till's sale, conflicting on the same original number.
    await db.outbox.clear();
    const second = await makeConflictedSale("OM-20260831-0001");
    const secondResult = await reissueOrder(second.operation_id);

    expect(firstResult.to).not.toBe(secondResult.to);

    const numbers = (await db.orders.toArray()).map((o) => o.order_number);
    expect(new Set(numbers).size).toBe(numbers.length);
  });
});

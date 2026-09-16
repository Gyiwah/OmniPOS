import { beforeEach, describe, expect, it } from "vitest";

import { clearLocalData, db } from "@/db/schema";
import { isUuid } from "@/core/uuidv7";
import { completeSale, nextOrderNumber } from "./checkout";
import type { CartLine } from "./cart";

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

async function seedProduct(stock = 10) {
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

describe("completing a sale offline", () => {
  beforeEach(async () => {
    await clearLocalData();
  });

  it("writes the order, queues one operation, and never touches the network", async () => {
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
      orderNumber: "OM-20260101-0001",
    });

    expect(isUuid(order.id)).toBe(true);
    expect(order.total).toBe("20.00");
    expect(order.amount_paid).toBe("20.00");
    expect(order._state).toBe("pending");

    expect(await db.orders.count()).toBe(1);

    const queued = await db.outbox.toArray();
    expect(queued).toHaveLength(1);
    expect(queued[0].entity).toBe("orders");
    expect(queued[0].record_id).toBe(order.id);
    // The idempotency key the server deduplicates on.
    expect(isUuid(queued[0].operation_id)).toBe(true);
  });

  it("decrements the local stock figure so the next customer sees the truth", async () => {
    await seedProduct(10);

    await completeSale({
      storeId: STORE,
      lines: [line({ quantity: 3 })],
      discountMode: "percentage",
      discountValue: 0,
      rates: NO_TAX,
      tenders: [{ method: "cash", amount: 3000 }],
      customer: null,
      registerShiftId: null,
      orderNumber: "OM-20260101-0002",
    });

    const product = await db.products.get("0192aaaa-0000-7000-8000-00000000000a");
    expect(product?.stock).toBe(7);
  });

  it("rejects a sale when local stock is insufficient", async () => {
    await seedProduct(1);

    await expect(completeSale({
      storeId: STORE,
      lines: [line({ quantity: 2 })],
      discountMode: "percentage",
      discountValue: 0,
      rates: NO_TAX,
      tenders: [{ method: "cash", amount: 2000 }],
      customer: null,
      registerShiftId: null,
      orderNumber: "OM-20260101-0006",
    })).rejects.toThrow("Not enough stock");

    expect(await db.orders.count()).toBe(0);
    expect((await db.products.get("0192aaaa-0000-7000-8000-00000000000a"))?.stock).toBe(1);
  });

  it("records change handed back without counting it as revenue", async () => {
    await seedProduct();

    const order = await completeSale({
      storeId: STORE,
      lines: [line()],
      discountMode: "percentage",
      discountValue: 0,
      rates: NO_TAX,
      tenders: [{ method: "cash", amount: 5000 }],
      customer: null,
      registerShiftId: null,
      orderNumber: "OM-20260101-0003",
    });

    expect(order.total).toBe("20.00");
    expect(order.amount_paid).toBe("20.00");
    expect(order.change_due).toBe("30.00");
    // The payment row carries the capped amount, not the note handed over.
    expect(order.payments[0].amount).toBe("20.00");
  });

  it("records a split tender as separate payment rows", async () => {
    await seedProduct();

    const order = await completeSale({
      storeId: STORE,
      lines: [line()],
      discountMode: "percentage",
      discountValue: 0,
      rates: NO_TAX,
      tenders: [
        { method: "cash", amount: 500 },
        { method: "mobile_money", amount: 1500 },
      ],
      customer: null,
      registerShiftId: null,
      orderNumber: "OM-20260101-0004",
    });

    expect(order.payments).toHaveLength(2);
    expect(order.payment_method).toBe("split");
    expect(order.payments.map((p) => p.amount)).toEqual(["5.00", "15.00"]);
  });

  it("leaves the unpaid remainder on a credit sale", async () => {
    await seedProduct();

    const order = await completeSale({
      storeId: STORE,
      lines: [line()],
      discountMode: "percentage",
      discountValue: 0,
      rates: NO_TAX,
      tenders: [{ method: "cash", amount: 500 }],
      customer: { id: "0192aaaa-0000-7000-8000-000000000005", name: "Ama", phone: null },
      registerShiftId: null,
      orderNumber: "OM-20260101-0005",
    });

    expect(order.total).toBe("20.00");
    expect(order.amount_paid).toBe("5.00");
    expect(order.customer_id).toBe("0192aaaa-0000-7000-8000-000000000005");
  });

  it("gives every sale a distinct id and operation id", async () => {
    await seedProduct(100);

    for (let i = 0; i < 25; i += 1) {
      await completeSale({
        storeId: STORE,
        lines: [line({ quantity: 1 })],
        discountMode: "percentage",
        discountValue: 0,
        rates: NO_TAX,
        tenders: [{ method: "cash", amount: 1000 }],
        customer: null,
        registerShiftId: null,
        orderNumber: await nextOrderNumber(STORE),
      });
    }

    const orders = await db.orders.toArray();
    const ops = await db.outbox.toArray();

    expect(new Set(orders.map((o) => o.id)).size).toBe(25);
    expect(new Set(orders.map((o) => o.order_number)).size).toBe(25);
    expect(new Set(ops.map((o) => o.operation_id)).size).toBe(25);
  });
});

describe("receipt numbering", () => {
  beforeEach(async () => {
    await clearLocalData();
  });

  it("increments within the day", async () => {
    const first = await nextOrderNumber(STORE);
    expect(first).toMatch(/^OM-\d{8}-0001$/);

    await seedProduct(100);
    await completeSale({
      storeId: STORE,
      lines: [line({ quantity: 1 })],
      discountMode: "percentage",
      discountValue: 0,
      rates: NO_TAX,
      tenders: [{ method: "cash", amount: 1000 }],
      customer: null,
      registerShiftId: null,
      orderNumber: first,
    });

    expect(await nextOrderNumber(STORE)).toMatch(/-0002$/);
  });
});

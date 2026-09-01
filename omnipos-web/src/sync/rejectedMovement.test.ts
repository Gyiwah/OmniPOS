import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/db/schema";
import { adjustStock } from "@/features/products/service";

/**
 * A stock movement the server refuses must not leave its optimistic change
 * behind on the till.
 *
 * The adjustment is applied locally as the manager types so the shelf figure
 * responds. When the push comes back a conflict, that adjustment happened
 * nowhere — and nothing else would correct it, because the changefeed publishes
 * the movement, not the product. The drift would sit there until the next full
 * bootstrap, quietly overstating stock.
 */

const PRODUCT = {
  id: "01a05000-0000-7000-8000-000000000001",
  store_id: "store-1",
  category_id: null,
  name: "Ginger Biscuits",
  sku: "GB-1",
  barcode: null,
  price: "3.50",
  cost_price: null,
  stock: 10,
  reorder_level: 0,
  image_url: null,
  tags: [],
  is_active: true,
  updated_at: "2026-09-01T00:00:00Z",
  search_key: "ginger biscuits gb-1",
};

async function pushOnce() {
  const { runSync } = await import("@/sync/engine");
  return runSync("store-1");
}

describe("a rejected stock movement", () => {
  beforeEach(async () => {
    vi.resetModules();
    await db.products.clear();
    await db.outbox.clear();
    await db.meta.clear();
    await db.products.put(PRODUCT);
    vi.stubGlobal("navigator", { onLine: true });
    // The client primes a CSRF cookie before any POST. Under the node test
    // environment there is no document, so give it an empty cookie jar rather
    // than a browser.
    vi.stubGlobal("document", { cookie: "" });
  });

  it("takes its optimistic quantity back off the local figure", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes("/api/sync/push")) {
        const op = await db.outbox.toArray();
        return new Response(
          JSON.stringify({
            results: [{
              operation_id: op[0].operation_id,
              status: "conflict",
              record_id: op[0].record_id,
              reason: "Unknown stock movement type [PURCHASE].",
            }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      // Devices, pull and anything else the cycle touches.
      return new Response(JSON.stringify({ cursor: 0, has_more: false, changes: [] }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }));

    await adjustStock({
      storeId: "store-1",
      productId: PRODUCT.id,
      delta: 48,
      type: "STOCK_IN",
      reason: "Opening delivery",
    });

    // Applied optimistically, before the server has seen it.
    expect((await db.products.get(PRODUCT.id))!.stock).toBe(58);

    await pushOnce();

    expect((await db.products.get(PRODUCT.id))!.stock).toBe(10);
  });

  it("keeps the optimistic quantity when the push merely failed and will retry", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes("/api/sync/push")) {
        const op = await db.outbox.toArray();
        return new Response(
          JSON.stringify({
            results: [{ operation_id: op[0].operation_id, status: "failed", record_id: null, reason: "Timed out." }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      return new Response(JSON.stringify({ cursor: 0, has_more: false, changes: [] }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }));

    await adjustStock({
      storeId: "store-1",
      productId: PRODUCT.id,
      delta: 5,
      type: "STOCK_IN",
      reason: "Delivery",
    });

    await pushOnce();

    // A retryable failure is not a rejection — the movement may still land, so
    // reversing it here would make the figure wrong in the other direction.
    expect((await db.products.get(PRODUCT.id))!.stock).toBe(15);
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * What a sale has to carry when it leaves the till.
 *
 * The push sent a total and nothing else. No line items ever reached the
 * server, so no product appeared in any report, and a refund was impossible:
 * the returns screen asks the server which lines are still eligible and was
 * told there were none. Three sales rung up on a device all landed with
 * order_items = 0.
 *
 * It also sent the tax and discount *rates* but not the amounts, which the
 * server stores on the order. Both columns defaulted to zero, so a receipt
 * reprinted from the server showed no tax on a sale that had charged it.
 */
describe("an order push carries the whole sale", () => {
  const checkout = readFileSync(join(process.cwd(), "src/app/pos/order-info.tsx"), "utf8");
  const payload = checkout.slice(checkout.indexOf('entity: "orders"'));

  it("sends the line items", () => {
    expect(payload).toMatch(/items: lines\.map\(/);
  });

  it("sends what each line was", () => {
    for (const field of ["product_id", "product_name", "unit_price", "quantity", "line_total"]) {
      expect(payload).toContain(`${field}:`);
    }
  });

  /** The amounts, not only the rates: the server stores both columns. */
  it("sends the tax and discount that were charged", () => {
    expect(payload).toMatch(/^\s*tax,$/m);
    expect(payload).toMatch(/discount: discountAmount/);
  });
});

/**
 * Who records the stock movement for a sale.
 *
 * Exactly one side must. The server creates one per order line, borrowing the
 * line's id so that replaying a sale cannot decrement twice. If the till also
 * pushes its own movement — a different id — the server keeps both and the
 * stock falls by twice what was sold. Measured against a running server: one
 * unit sold took a product from 90 to 88.
 */
describe("only one side records the movement", () => {
  const stock = readFileSync(join(process.cwd(), "src/features/orders/stock.ts"), "utf8");

  it("does not push order-driven movements under Laravel", () => {
    const pushes = stock.match(/push: !usingLaravel/g) ?? [];

    // One for the sale, one for the refund.
    expect(pushes).toHaveLength(2);
  });

  /**
   * The row is still written locally. A till that waited for the server to
   * confirm would show the previous customer's stock to the next one.
   */
  it("still records the movement locally", () => {
    expect(stock).toContain("recordStockMovement");
    expect(stock).toMatch(/type: "SALE"/);
    expect(stock).toMatch(/type: "RETURN"/);
  });
});

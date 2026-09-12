import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A stock movement should say which sale caused it.
 *
 * The server has always read source_type and source_id from the push payload,
 * and its own handlers set them — a refund it processes records
 * sourceType 'return'. Only the movements the till pushes from its own queue
 * arrived without them, so the ledger recorded that a unit left the shelf and
 * not why. At a stock take that is an unexplained decrement nobody can tie back
 * to a receipt, which is the one question a ledger exists to answer.
 *
 * The cause was structural rather than an omission: decrementStockForOrder ran
 * before the order row existed, so there was no id to record. The id is minted
 * up front now, which is what client-minted UUIDv7 is for.
 *
 * Read from source: the write path needs the native database and a server.
 */
describe("stock movements name their cause", () => {
  const service = readFileSync(
    join(process.cwd(), "src/features/inventory/stockMovementService.ts"),
    "utf8",
  );
  const stock = readFileSync(join(process.cwd(), "src/features/orders/stock.ts"), "utf8");
  const checkout = readFileSync(join(process.cwd(), "src/app/pos/order-info.tsx"), "utf8");

  it("sends the source on the wire, where the server already looks for it", () => {
    expect(service).toMatch(/source_type:\s*params\.sourceType/);
    expect(service).toMatch(/source_id:\s*params\.sourceId/);
  });

  it("records the sale against both the decrement and the rollback", () => {
    const sale = stock.slice(stock.indexOf('type: "SALE"'));
    const ret = stock.slice(stock.indexOf('type: "RETURN"'));

    expect(sale).toMatch(/sourceId: orderId/);
    expect(ret).toMatch(/sourceId: orderId/);
  });

  /**
   * The id has to exist before the stock moves, or there is nothing to record.
   * This is the ordering the bug came from.
   */
  it("mints the order id before any stock is touched", () => {
    const mint = checkout.indexOf("const orderId = uuidv7()");
    const decrement = checkout.indexOf("decrementStockForOrder(activeStoreId, lines, orderId)");

    expect(mint).toBeGreaterThan(-1);
    expect(decrement).toBeGreaterThan(-1);
    expect(mint).toBeLessThan(decrement);
  });

  /**
   * Every path that creates the order must use that same id, or the movements
   * name a sale which does not exist — worse than naming none at all.
   */
  it("gives the order the id the movements were recorded against", () => {
    expect(checkout).toMatch(/rec\._raw\.id = orderId/);
    expect(checkout).toMatch(/^\s*id: orderId,$/m);
    expect(checkout).not.toMatch(/saveOrderOffline\(orderNumber, cashierUserId\)/);
  });

  /** Available on the rollback path, which is when tracing matters most. */
  it("can name the sale while undoing it", () => {
    expect(checkout).toMatch(/restoreStockForOrder\(activeStoreId, lines, orderId\)/);
  });
});

import Dexie, { type Table } from "dexie";

/**
 * The till's local database.
 *
 * This is the source of truth the UI reads from. The POS never waits on the
 * network to render a product list, add to a cart, or complete a sale — it reads
 * and writes here, and the sync engine reconciles with the server afterwards.
 *
 * Record ids are the server's ids: both clients mint UUIDv7 locally and the API
 * accepts them verbatim, so nothing is renumbered when a record syncs.
 */

/**
 * Where a local record stands relative to the server.
 *
 * `conflict` and `discarded` exist so the Orders list can never imply a sale is
 * on the books when it is not. A cashier reprinting a receipt needs to know
 * whether that sale actually reached the server.
 */
export type SyncState = "clean" | "pending" | "conflict" | "discarded";

export interface LocalProduct {
  id: string;
  store_id: string;
  category_id: string | null;
  name: string;
  sku: string;
  barcode: string | null;
  price: string;
  cost_price: string | null;
  stock: number;
  reorder_level: number;
  image_url: string | null;
  tags: string[];
  is_active: boolean;
  updated_at: string;
  /** Lowercased name+sku, so search does not lowercase on every keystroke. */
  search_key: string;
}

export interface LocalCategory {
  id: string;
  store_id: string;
  name: string;
  color: string | null;
  position: number;
}

export interface LocalCustomer {
  id: string;
  store_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  total_spend: string;
  outstanding_balance: string;
  updated_at: string;
  search_key: string;
  _state: SyncState;
}

export interface LocalOrderLine {
  id: string;
  product_id: string | null;
  product_name: string;
  sku: string | null;
  barcode: string | null;
  unit_price: string;
  quantity: number;
  line_total: string;
  unit_cost: string | null;
}

export interface LocalPaymentSplit {
  id: string;
  method: string;
  amount: string;
  reference: string | null;
}

export interface LocalOrder {
  id: string;
  store_id: string;
  order_number: string;
  status: string;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  register_shift_id: string | null;
  subtotal: string;
  tax: string;
  discount: string;
  total: string;
  amount_paid: string;
  change_due: string;
  payment_method: string;
  items: LocalOrderLine[];
  payments: LocalPaymentSplit[];
  /** When the sale happened at this till. The server reports on this, not on when it received it. */
  client_created_at: string;
  _state: SyncState;
}

/**
 * A cash drawer session.
 *
 * Held locally because opening and closing a drawer must work with no
 * connection — that is precisely the shift a shop most needs to reconcile. The
 * server recomputes expected_cash from the payments ledger and sends it back
 * through the changefeed, so the figure shown after a sync is the server's, not
 * this till's guess.
 */
export interface LocalCashMovement {
  id: string;
  direction: "in" | "out";
  amount: string;
  reason: string;
  at: string;
}

export interface LocalShift {
  id: string;
  store_id: string;
  cashier_user_id: string;
  cashier_name: string;
  opened_at: string;
  closed_at: string | null;
  opening_float: string;
  cash_in: string;
  cash_out: string;
  /** What was actually counted at close. Null while the shift is open. */
  actual_cash: string | null;
  /** The server's figure once it has been pulled back; null until then. */
  expected_cash: string | null;
  status: "open" | "closed";
  notes: string | null;
  movements: LocalCashMovement[];
  _state: SyncState;
}

export interface LocalReturnLine {
  id: string;
  /** The sold line this refunds. The server checks eligibility against it. */
  order_item_id: string;
  product_id: string | null;
  product_name: string;
  unit_price: string;
  quantity: number;
  line_total: string;
  restock: boolean;
}

export interface LocalReturn {
  id: string;
  store_id: string;
  order_id: string;
  order_number: string;
  register_shift_id: string | null;
  reason: string;
  amount: string;
  refund_method: string;
  items: LocalReturnLine[];
  client_created_at: string;
  _state: SyncState;
}

/**
 * A delivery of one product, with its own expiry date.
 *
 * Held locally so the inventory screen can flag expired and expiring stock with
 * no connection — which is when a shop is most likely to be doing a physical
 * check of its shelves. The quantities here are informational; what a product
 * has on hand still comes from the ledger.
 */
export interface LocalBatch {
  id: string;
  store_id: string;
  product_id: string;
  batch_number: string | null;
  quantity: string;
  cost_price: string | null;
  expiry_date: string | null;
  _state: SyncState;
}

/**
 * Money taken against a customer's account, outside a sale.
 *
 * Held locally for two reasons. A shop that lets customers buy on credit will
 * have them come back on Saturday to pay some of it off, and that cannot depend
 * on a connection. And a cash settlement is cash in the drawer — if the till did
 * not know about it, its own reconciliation would come out short by every debt
 * paid during the shift, while the server's came out right.
 *
 * Tenders taken as part of a sale are NOT here; they live on the order.
 */
export interface LocalPayment {
  id: string;
  store_id: string;
  customer_id: string;
  customer_name: string;
  /** Set when the settlement is against one specific invoice. */
  order_id: string | null;
  register_shift_id: string | null;
  method: string;
  amount: string;
  reference: string | null;
  notes: string | null;
  client_created_at: string;
  _state: SyncState;
}

/**
 * The outbox.
 *
 * Every local write that the server needs to know about lands here first. Each
 * row carries an operation_id that never changes across retries — that is the
 * idempotency key the API deduplicates on, and it is why a checkout interrupted
 * by a dropped connection cannot book the sale twice.
 */
export interface SyncOperation {
  operation_id: string;
  store_id: string;
  entity: string;
  action: "upsert" | "delete";
  record_id: string;
  payload: unknown;
  attempts: number;
  last_error: string | null;
  /** Conflicts are kept, not deleted: a rejected sale needs a human, not silence. */
  status: "pending" | "conflict";
  created_at: string;
}

export interface MetaRow {
  key: string;
  value: unknown;
}

export class OmniposDatabase extends Dexie {
  products!: Table<LocalProduct, string>;
  categories!: Table<LocalCategory, string>;
  customers!: Table<LocalCustomer, string>;
  orders!: Table<LocalOrder, string>;
  shifts!: Table<LocalShift, string>;
  returns!: Table<LocalReturn, string>;
  payments!: Table<LocalPayment, string>;
  batches!: Table<LocalBatch, string>;
  outbox!: Table<SyncOperation, string>;
  meta!: Table<MetaRow, string>;

  constructor() {
    super("omnipos");

    this.version(1).stores({
      products: "id, store_id, sku, barcode, category_id, search_key, updated_at",
      categories: "id, store_id, position",
      customers: "id, store_id, phone, search_key, _state, updated_at",
      orders: "id, store_id, order_number, client_created_at, _state, customer_id",
      outbox: "operation_id, store_id, entity, status, created_at",
      meta: "key",
    });

    /*
     * v2 indexes outbox.record_id.
     *
     * When a change arrives from the server the till has to ask "am I still
     * holding a conflict for this record?" — which is how it discovers that a
     * manager settled it from another device. Without the index that lookup is a
     * full scan of the outbox on every pulled change.
     */
    this.version(2).stores({
      outbox: "operation_id, store_id, entity, status, record_id, created_at",
    });

    /*
     * v3 adds the drawer and the refunds.
     *
     * Both are money paths, so both are local-first for the same reason sales
     * are: a shop with no connection still opens its till in the morning and
     * still takes goods back over the counter. Neither may wait on a request.
     */
    this.version(3).stores({
      shifts: "id, store_id, status, opened_at, cashier_user_id, _state",
      returns: "id, store_id, order_id, client_created_at, _state",
    });

    /*
     * v4 adds settlements against a customer's account.
     *
     * Indexed by register_shift_id because the drawer needs them: a cash
     * settlement taken mid-shift is money in the box, and a till that could not
     * see it would reconcile short by every debt paid that day.
     */
    this.version(4).stores({
      payments: "id, store_id, customer_id, register_shift_id, client_created_at, _state",
    });

    /*
     * v5 adds batches.
     *
     * Local because expiry is a shelf question, and a shop walking its shelves
     * with a tablet is exactly the case where the connection is worst. Indexed
     * by product so the inventory list can resolve every product's worst batch
     * without scanning the table once per row.
     */
    this.version(5).stores({
      batches: "id, store_id, product_id, expiry_date, _state",
    });
  }
}

export const db = new OmniposDatabase();

export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const row = await db.meta.get(key);
  return row ? (row.value as T) : fallback;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}

/**
 * Wipe local state. Used on sign-out and when switching store.
 *
 * Tables are cleared sequentially rather than with Promise.all: Dexie tracks the
 * active transaction through its own promise zone, and awaiting a native
 * Promise.all inside a transaction drops that context, so the clears fail
 * part-way. That left the catalogue wiped while the caller's error handler never
 * ran — a half-signed-out till.
 */
export async function clearLocalData(): Promise<void> {
  await db.transaction(
    "rw",
    [db.products, db.categories, db.customers, db.orders, db.shifts, db.returns, db.payments, db.batches, db.outbox, db.meta],
    async () => {
      await db.products.clear();
      await db.categories.clear();
      await db.customers.clear();
      await db.orders.clear();
      await db.shifts.clear();
      await db.returns.clear();
      await db.payments.clear();
      await db.batches.clear();
      await db.outbox.clear();
      await db.meta.clear();
    },
  );
}

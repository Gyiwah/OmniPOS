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
  await db.transaction("rw", [db.products, db.categories, db.customers, db.orders, db.outbox, db.meta], async () => {
    await db.products.clear();
    await db.categories.clear();
    await db.customers.clear();
    await db.orders.clear();
    await db.outbox.clear();
    await db.meta.clear();
  });
}

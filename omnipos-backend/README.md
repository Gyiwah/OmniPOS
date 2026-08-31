# OmniPOS backend

Laravel 12 API on PostgreSQL. Replaces the Supabase project that currently backs
the OmniPOS mobile app, and will serve the forthcoming web/PWA client from the
same database.

---

## Setup

Already done on this machine: extensions enabled, dependencies installed,
database migrated and seeded. To reproduce elsewhere:

```bash
composer install
copy .env.example .env
php artisan key:generate
```

Set `DB_DATABASE` and `DB_PASSWORD` in `.env`, create the database, then:

```bash
php artisan migrate --seed
php artisan serve
```

Requires PHP 8.2+ with `pdo_pgsql`, `pgsql` and `zip` enabled (they ship with
XAMPP but are commented out in `php.ini`).

Demo accounts all use the password `password`:
`super@` (super admin), `admin@`, `manager@`, `cashier@` — all `@omnipos.test`.

### Tests

```bash
vendor/bin/phpunit --testdox
```

50 tests cover the guarantees the design rests on: push idempotency,
ledger-based stock under concurrent offline sales, conflict reporting, role
separation, pull cursors, cross-tenant isolation, the Supabase import, and the
resource controllers. Two are architectural guards that fail the build rather
than a request: RouteGuardTest asserts every store-scoped route carries the
tenancy middleware, and the mobile repo has an equivalent guard on its shared
core. They leave no residue in the database.

---

## What replaced what

| Supabase | Here |
|---|---|
| `auth.users` + `profiles` | `users` (folded — see below) |
| GoTrue | Laravel auth + Sanctum |
| `auth.uid()` | `$request->user()` |
| RLS policies | `EnsureStoreAccess` middleware + policies |
| `accept_pending_store_invites()` | `StoreInviteService::acceptPendingFor()` |
| `provision_store_with_admin()` | `StorePolicy::provision` + service |
| `invite-store-member` Edge Function | `StoreInviteService::invite()` |
| `create-store-with-admin` Edge Function | store provisioning service |
| Realtime publication | `sync_changes` changefeed |
| `sync_log` (empty, unused) | `sync_changes` + `sync_operations` |
| Storage bucket | Laravel filesystem, store-scoped paths |

**`profiles` was folded into `users`.** That table existed in Supabase only
because `auth.users` is owned by GoTrue and cannot be extended. Laravel owns the
users table, so a second table joined 1:1 on every request would be pure
overhead. This matches §7 of the migration plan, which maps `profiles` to
"Laravel profile/user structure" rather than to a literal table.

---

## Three things to understand before changing anything

### 1. Authorisation has no database backstop any more

Under Supabase, every table carried an RLS policy calling
`is_store_member(store_id)`. A query that forgot to filter by store still
returned nothing it shouldn't. **Postgres gives us no such protection here.** An
unscoped query returns every tenant's rows.

So: every store-scoped route carries the `store.access` middleware, and
controllers read the store id from `$request->attributes->get('store_id')` —
never from the query string or body directly. The middleware is what turns
attacker-controlled input into an authorised value.

Adding a store-scoped route without that middleware exposes every tenant.

### 2. Inventory is a ledger, not a number

`products.stock` is a cache. `stock_movements` is the truth.

Two tills, both offline, both showing 20 units. A sells 5, B sells 8. They push
movements of −5 and −8, and the server settles at 7. Had they synced an absolute
stock value, A would push 15, B would push 12, and the later arrival would
overwrite the earlier — one sale erased from inventory.

All stock changes go through `InventoryService::recordMovement()`, which appends
to the ledger and derives the cached column. `ProductHandler` deliberately
ignores any `stock` field a client sends.

Negative stock is allowed. An offline terminal pushes sales that already happened
and were receipted; rejecting them because another till sold the last unit first
would discard real revenue. Oversells surface via
`InventoryService::oversoldProducts()` for a human to reconcile.

### 3. Pull deliberately lags reality by a second

`sync_changes.sequence` is a `bigserial`. Sequence numbers are assigned at INSERT
time but rows become visible at COMMIT time, and those orders differ. Transaction
A can take sequence 100, B take 101 and commit first; a client reading
"everything above 99" sees 101, advances its cursor, and **never sees 100** when
it commits a moment later. That change is lost permanently — here, a lost sale.

`SyncService::stabilityCutoff()` therefore only serves changes older than
`OMNIPOS_SYNC_STABILITY_WINDOW_MS` (default 1000ms), giving in-flight
transactions time to commit. Irrelevant for clients that are routinely offline
for hours.

The rigorous alternative is `pg_snapshot_xmin(pg_current_snapshot())` — serve
strictly below the oldest running transaction. Worth adopting if the window ever
proves too coarse.

---

## Sync API

```
POST /api/sync/devices     register this installation
POST /api/sync/push        upload local operations
GET  /api/sync/pull        download changes after a cursor
```

Push is idempotent on a client-generated `operation_id`, recorded under a unique
index. A retry after a lost response is recognised and answered from the stored
result rather than re-applied — otherwise a retried checkout books the sale
twice.

```jsonc
// POST /api/sync/push
{
  "device_id": "0192f2c1-...",
  "operations": [{
    "operation_id": "0192f2c2-...",   // idempotency key
    "entity": "orders",
    "action": "upsert",
    "record_id": "0192f2c3-...",      // the client-minted UUID
    "payload": { }
  }]
}
```

Returns HTTP 200 even when some operations conflict. A conflict is a
per-operation outcome the client reconciles individually, not a request failure —
returning an error status would make clients retry the whole batch, including the
operations that succeeded.

Entity names match the mobile client's existing sync queue vocabulary
(`src/sync/enqueue.ts`), so no client-side renaming is needed at cutover.

---

## Identity

Every table uses a UUID primary key with **no database default**. Clients mint
UUIDv7 offline and the server accepts them verbatim: a record's local key IS its
server key.

That is what makes push a plain idempotent upsert rather than a reconciliation
problem, and it is why the mobile client's `remote_id` column and its SKU-fallback
matching can be deleted at cutover. See the mobile repo's `src/core/README.md`.

Server-originated records get a v7 key from `HasClientMintedUuid`. v7 rather than
v4 because these are Postgres primary keys: the leading timestamp keeps inserts
near-sequential in the B-tree instead of scattering them.

---

## Not built yet

Done and verified: 23 migrations (30 tables, 63 foreign keys, 26 check
constraints), 23 models, authorisation, auth, the sync engine, the Supabase data
migration (see MIGRATION.md), 62 REST endpoints across 10 resource controllers,
and 50 passing tests.

Still to come, in the plan's module order (§51):

- resource controllers per module (products, inventory, customers, POS, orders,
  returns, register, staff) — route stubs are commented in `routes/api.php`
- reporting endpoints
- object storage for product images and store logos
- `returns` sync handler — the schema is in place, the handler is not

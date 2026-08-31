# Supabase → PostgreSQL data migration

Runbook for moving live OmniPOS data off Supabase. Covers sections 37–39 and 49
of the migration plan.

Supabase is only ever read from. Nothing in this process writes to or deletes
from the Supabase project, so it stays available as a rollback source.

---

## Commands

```bash
php artisan omnipos:import-supabase --list     # show the steps in order
php artisan omnipos:import-supabase            # run the import
php artisan omnipos:validate-import            # prove it landed
```

Useful flags: `--only=orders,payments`, `--skip=stock_movements`, `--chunk=1000`.

## Configure the source

In `.env`, from Supabase Dashboard → Project → Connect:

```
SUPABASE_DB_HOST=
SUPABASE_DB_PORT=5432
SUPABASE_DB_DATABASE=postgres
SUPABASE_DB_USERNAME=
SUPABASE_DB_PASSWORD=
SUPABASE_DB_SSLMODE=require
```

Remove these once the migration is verified.

---

## The import is safe to run repeatedly

Every step skips rows already present. That means it can be:

- **resumed** after a failure — fix the cause, run again
- **rehearsed** against a copy of production as many times as you like
- **re-run at cutover** to sweep up the last hours of trading

A second run over unchanged data is a verified no-op: no duplicate sales, no
double-counted stock, no duplicate memberships.

## Identity is preserved

Supabase primary keys are UUIDs and this schema accepts client-minted UUIDs with
no database default, so **every id carries across unchanged**. Receipts keep
their numbers, foreign keys keep pointing at the same rows, and mobile devices
holding local copies keep matching. Nothing is renumbered.

---

## Four transformations that are not one-to-one

Everything else is a straight copy. These four are decisions, and each one is a
place where a careless migration would quietly corrupt the books.

### 1. Stock becomes a ledger

Products import with `stock = 0`, historical `stock_movements` import verbatim,
and then the `stock_reconcile` step posts one adjusting `AUDIT` movement per
product so the ledger sums to exactly the quantity Supabase reported.

Writing Supabase's absolute stock in directly *and* importing the movements would
count the same units twice. Reconciling instead preserves the movement history
and still lands on the count the shop has actually been trading against. The
adjustment is visible in the ledger with an explicit reason rather than being an
unexplained jump.

### 2. Payments are synthesised

Supabase stored one `payment_method` string and an `amount_paid` per order. One
payment row is created per paid order so that takings, customer balances and
drawer reconciliation have a ledger to read.

Orders marked `split` become method `other`, not `cash`. The tender breakdown was
never recorded and cannot be invented; filing it as cash would make every
affected till appear short at reconciliation. `other` records the money honestly
and keeps it out of the cash total.

### 3. Passwords carry over, mostly

GoTrue stores bcrypt (`$2a$`) and Laravel's default hasher is bcrypt.
`password_verify` accepts `$2a$`/`$2b$`/`$2y$` interchangeably, so **existing
passwords keep working and users are not forced through a reset**.

Anything that is not a bcrypt hash is discarded and the account is left with no
password. These are the invite-only and magic-link accounts that never had one;
they must set a password before signing in. The import reports the count, and
`validate-import` reports it again.

### 4. Customer balances are recomputed, not copied

`total_spend` and `outstanding_balance` were maintained by clients and can
disagree with the order history. They are rebuilt from orders and payments. The
order history is the evidence; the running totals were a cache.

## Two things that cannot be recovered

- **`client_created_at` on historical orders** is set from `created_at`. Supabase
  never recorded when a sale happened on the device, only when the server
  received it. For offline sales those differ, sometimes by hours. Sales reports
  over historical data are therefore accurate to server-receipt time; only
  post-cutover sales carry a true till time.
- **`unit_cost` on historical order lines** is left null rather than back-filled
  from today's cost price. Today's cost is not what the item cost when it sold,
  and writing it would produce margin reports that look precise and are wrong.

Also absent: `register_shifts` (no Supabase table ever existed), and `device_id`
on historical records (no devices were registered).

---

## Validation

`omnipos:validate-import` exits non-zero if anything disagrees, so it can gate a
cutover script. It checks:

- **Record counts** per table against the source.
- **Financial totals** — gross sales, amount paid, tax, discount, refunds, line
  value, stock on hand — compared to the cent. A migration that moves every row
  but changes the day's takings has failed.
- **Integrity** — that every product's cached stock equals its ledger, that no
  order lines are orphaned, how many users need a password reset, and whether any
  product is oversold.

Compare by store and by date as well before going live (plan §39):

```bash
php artisan omnipos:validate-import --store=<uuid>
```

---

## Cutover sequence

1. Rehearse the whole thing against a copy. More than once.
2. Announce the window; stop new trading on the old system.
3. Take a final Supabase backup (`pg_dump`).
4. `php artisan omnipos:import-supabase`
5. `php artisan omnipos:validate-import` — must exit 0.
6. Spot-check by hand: a few receipts, one customer's balance, one product's
   stock against a physical count.
7. Point the mobile clients at the Laravel API.
8. Watch synchronisation for the first day.

**Do not delete the Supabase project.** Keep it as a rollback and reference
source until the new system has been stable in production for a meaningful
period.

---

## Tested

`tests/Feature/SupabaseImportTest.php` runs the real importer against a mock
Supabase schema built inside the test database, and asserts: identity is
preserved, bcrypt hashes carry over while unusable ones are discarded, the ledger
reconciles to the source quantity, split tender is not filed as cash, customer
totals are recomputed rather than copied, and a second run changes nothing.

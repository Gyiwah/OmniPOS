# Supabase → PostgreSQL data migration

Runbook for moving live OmniPOS data off Supabase. Covers sections 37–39 and 49
of the migration plan.

Supabase is only ever read from. Nothing in this process writes to or deletes
from the Supabase project, so it stays available as a rollback source.

---

## Commands

```bash
php artisan omnipos:preflight-supabase         # what would fail. Reads only.
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

## Start with the pre-flight

```bash
php artisan omnipos:preflight-supabase --examples
```

It reads Supabase and this database and writes to neither, so it is safe against
production at any time. It exits non-zero if anything blocking is found, which
means a cutover script can refuse to continue.

Every finding is graded, and the grade is the useful part.

**BLOCKING** — the row cannot be inserted. Something has to change in Supabase,
or somebody has to decide that row is not coming. The import is additive, so a
blocking row does not corrupt anything; it simply is not there afterwards, and
nobody notices until a customer asks about it.

**ALTERED** — the row imports, but not unchanged. A movement type that has no
equivalent and becomes `ADJUSTMENT`; a payment method that becomes `other` and is
then excluded from drawer reconciliation. Nothing is lost, but a report will look
different and that should not be a surprise.

**WORTH KNOWING** — no constraint is involved. A store with no admin, a line
returned more times than it was sold, split-tender sales whose cash breakdown
Supabase never recorded and which therefore cannot be recovered.

### What to do about each blocking finding

| Finding | What it means | The usual fix |
|---|---|---|
| Two accounts share an email | GoTrue allowed the same address under two providers | Decide which account is the real one; change the other's address in Supabase |
| Password hash is not bcrypt | The account imports but can never sign in | Note it; the person resets their password after cutover |
| Store owner missing | `owner_user_id` is a restricted foreign key | Point the store at a real user, or accept losing it |
| Duplicate SKU in one store | The target makes `(store, sku)` unique | Renumber one of them in Supabase |
| Duplicate receipt number | Each is a sale someone holds a receipt for | Renumber the later one; the customer's copy stays valid as a reference |
| Batch with no number | The target requires one | Give it one, or delete the batch if it holds nothing |
| Rate outside 0–100 | A tax rate stored as a fraction rather than a percent | Correct it in Supabase |

Fix them in Supabase rather than in the importer. The importer is deliberately a
copier; teaching it to repair data would mean the thing that lands is not the
thing that was there.

---

## Rehearsing

Rehearse against a scratch database, not the one you intend to go live on. The
importer is idempotent, but a rehearsal that leaves rows behind makes the next
one's counts meaningless.

```bash
# 1. A scratch target, separate from production.
createdb omnipos_rehearsal

# 2. Point this app at it — in .env, not by editing config.
#    DB_DATABASE=omnipos_rehearsal

# 3. Build the schema from nothing. This DROPS EVERY TABLE in the database
#    named above, so read that line again before running it.
php artisan migrate:fresh

# 4. The three steps, in order.
php artisan omnipos:preflight-supabase --examples
php artisan omnipos:import-supabase
php artisan omnipos:validate-import
```

Between rehearsals, `migrate:fresh` again. Do not import twice onto the same
rehearsal database expecting to learn anything — the second run is a no-op by
design, which proves idempotency and nothing else.

Time the import. A rehearsal that takes forty minutes tells you how long the shop
is closed on the night, and that is usually the number the decision turns on.

**What a good rehearsal proves**, beyond the validator passing:

- how long it takes, on data the size of production;
- that the blocking list is empty, or that every entry on it has a decision;
- that a sample of receipts, one customer balance and one physical stock count
  agree with the old system;
- that somebody can sign in afterwards.

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

1. `omnipos:preflight-supabase` against production Supabase, and clear every
   blocking finding.
2. Rehearse the whole thing against a scratch database. More than once, and time
   it.
3. Announce the window; stop new trading on the old system.
4. Take a final Supabase backup (`pg_dump`).
5. `php artisan omnipos:preflight-supabase` once more — trading since the
   rehearsal may have introduced something new.
6. `php artisan omnipos:import-supabase`
7. `php artisan omnipos:validate-import` — must exit 0.
8. Spot-check by hand: a few receipts, one customer's balance, one product's
   stock against a physical count.
9. Point the mobile clients at the Laravel API.
10. Watch synchronisation for the first day.

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

`tests/Feature/SupabasePreflightTest.php` builds a source containing each problem
the audit looks for — a shared email, a non-bcrypt hash, an ownerless store, a
duplicate SKU, a duplicate receipt number, a numberless batch, an unknown
movement type, a store with no admin, an over-returned line — and asserts each is
reported at the right grade. A clean fixture is asserted to produce nothing
blocking, so a check that quietly stopped working would fail the suite rather
than pass it.

`tests/Unit/LegacyStatusTest.php` covers the status mapping on its own, because
the importer and the audit both depend on it and once disagreed.

## What a full rehearsal found

The three commands were run end to end against a stand-in Supabase database on a
separate PostgreSQL database, seeded with the hazards a live project has: a
duplicate email under two providers, an argon2 hash, an unknown movement type, a
`part_paid` order, split tender, a branch with no admin, and the same SKU used
legitimately in two different stores.

It found three things the test suite had not.

**The audit named the wrong schema.** Source tables were qualified `legacy.`,
copying the mock schema the tests build, so it worked only under test — against a
real project every query would have failed on the first table. Both the importer
and the audit now name source tables unqualified and let the connection's
`search_path` resolve them.

**The importer did not map order status.** The audit reported `part_paid` as
"will be mapped"; the importer passed it straight through, and the run died on
`orders_status_check` two thirds of the way into the orders step. The mapping now
lives in one class that both use, so the audit cannot promise something the
importer does not do. An unrecognised status is BLOCKING rather than guessed at —
guessing `completed` invents takings and guessing `draft` erases them.

**Every product with complete movement history imported as zero stock.** Products
arrive with `stock = 0` and their movements are inserted directly, which never
touches the cache; only the adjusting branch wrote it, as a side effect of
`recordMovement`. A product whose Supabase history already summed to its reported
quantity took the other branch and kept a cached zero — reading as OUT OF STOCK at
the till while its ledger said forty. The suite missed it because both fixture
products needed an adjustment.

The validator also had to change. It counted the reconciliation's own AUDIT
movements as a row mismatch, and compared Supabase's literal `completed` total
against a target where `part_paid` had become `completed` — so it failed every
successful migration by exactly the credit sales. A gate that always fails is a
gate nobody reads. It now excludes migration movements and sums the source over
every status that maps to completed.

After those fixes the sequence runs clean: pre-flight exits 0, the import
completes, and the validator reports every count and every financial total in
agreement.

**None of this has touched real production data.** A stand-in database seeded to
look like Supabase is a rehearsal of the procedure, not of the data — the real
project will have its own shape, and the pre-flight exists to tell you what it
is.

# OmniPOS

Multi-platform point of sale: an offline-first mobile till, an offline-first web
till, and a Laravel/PostgreSQL backend they both sync against.

```
omnipos-backend/   Laravel 12 API + PostgreSQL
omnipos-web/       React 19 + Vite + IndexedDB PWA
omnipos-mobile/    React Native + Expo + WatermelonDB
```

Each project has its own README with setup steps and the reasoning behind its
design. Start there.

---

## Where the migration stands

The platform is moving off Supabase onto a Laravel API and a standalone
PostgreSQL database.

| | |
|---|---|
| Backend | Built and tested. Schema, authorisation, auth, sync, reports, Supabase importer. |
| Web till | Built and tested. Sells offline, syncs, resolves conflicts. |
| Mobile till | **Still syncing against Supabase.** Not yet repointed. |

Supabase stays live and untouched until the mobile app has been migrated and
proven, per the plan's staged approach.

---

## The three ideas everything else follows from

**A record's local id is its server id.** Both clients mint UUIDv7 primary keys
offline and the server accepts them verbatim. That is what turns the sync push
into a plain idempotent upsert instead of a reconciliation problem.

**Inventory is a ledger, not a number.** `stock_movements` is authoritative;
`products.stock` is a cache derived from it. Two offline tills can each sell the
last unit and both sales survive, because they push movements rather than
absolute quantities.

**Nothing that took money is ever silently dropped.** A push the server refuses
becomes a conflict that is kept, surfaced, and settled by a manager — from any
till, since the server holds the payload. Losing a receipted sale quietly is the
worst outcome available to a POS, and most of the sync design exists to prevent
it.

---

## Running the whole thing locally

Backend first — the other two need it:

```bash
cd omnipos-backend && php artisan serve
```

```bash
cd omnipos-web && npm run dev
```

```bash
cd omnipos-mobile && npm start
```

Seeded accounts (after `php artisan db:seed`) all use the password `password`:
`super@`, `admin@`, `manager@`, `cashier@omnipos.test`.

---

## What is not done

- Production data has not been migrated. `omnipos-backend/MIGRATION.md` is the
  runbook; the importer is idempotent and meant to be rehearsed first.
- ESC/POS receipt printing. The web till prints through the browser today.
- Category management, product images and a super-admin area on the web. The API
  supports all three; mobile has the last two.
- A cold offline start of the web PWA has not been executed in a real browser —
  the precache is verified by test, the cache-serving step is not.

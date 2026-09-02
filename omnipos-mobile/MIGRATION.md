# Mobile: migrating from Supabase to the Laravel API

Staged on purpose. Supabase stays live and authoritative until a Laravel build
has been proven against real tills, per §57 of the migration plan.

```bash
EXPO_PUBLIC_BACKEND=laravel
EXPO_PUBLIC_API_URL=http://192.168.1.10:8000   # reachable FROM THE DEVICE
```

Unset, or set to `supabase`, the app behaves exactly as before. Nothing in this
work changes the Supabase path.

---

## What is a transport switch, and what is not

`src/sync/index.ts` is the only place the sync choice is made, and each migrated
feature makes the same choice once at the bottom of its `service.ts`:

```ts
export const storesService = usingLaravel ? laravelStoresService : supabaseStoresService;
```

Callers — the orchestrator, the manual Sync button, the screens, the hooks —
import the service and know nothing about which backend answers. That means
retiring Supabase is a set of one-line edits plus deletions, not a rewrite. It
also means there are **not** two implementations competing: there is one
protocol, spoken by two transports, and only one of them is live at a time.

---

## Done

**Authentication** — `src/features/auth/laravelAuth.ts`

Sanctum bearer tokens rather than the cookie session the web till uses: a native
app has no shared cookie jar, and a token survives the app being backgrounded for
days, which matters for a till that may not be opened over a weekend. The token
is a credential, so it goes to the OS keychain where one exists.

Sign-out clears the local token first and unconditionally. A till that cannot
reach the server must still be able to lock itself.

**Sync** — `src/sync/laravelSync.ts`

Push and pull against `/api/sync/*`, consuming the existing `sync_queue` table
unchanged.

The important detail: **the queue row's own id is the server's `operation_id`.**
Every row now gets a UUIDv7 primary key, minted once when the local write
happened and never regenerated. That is exactly the property idempotency needs —
if the connection drops after the server commits but before the response
arrives, the retry carries the same id and the server replays its stored result
instead of booking the sale twice. No schema change was required; the identity
work did it.

Nothing may ever mint a fresh id for an existing queue row.

**API client** — `src/core/api/client.ts`

Distinguishes "unreachable" (retry later) from "rejected" (do not retry),
including the gateway statuses a reverse proxy returns while the backend is
down — a till behind nginx during an outage should read as offline, not as a
server error.

**Every remaining read path** — one Laravel implementation per feature:

| Area | Laravel implementation | Endpoints |
|---|---|---|
| Stores | `features/stores/laravelStores.ts` | `GET /api/stores` |
| Settings & staff | `features/settings/laravelSettings.ts` | `/api/store`, `/api/store-members`, `/api/store-invites` |
| Analytics | `features/analytics/laravelAnalytics.ts` | `/api/reports/dashboard`, `/api/reports/sales` |
| Returns | `features/returns/laravelReturns.ts` | `/api/returns`, `/api/returns/eligibility/{order}` |
| Images | `services/laravelStorage.ts` | `/api/media` |
| Super admin | `features/superAdmin/laravelSuperAdmin.ts` | `GET`/`POST /api/admin/stores` |

Two of these are deliberately server-side rather than local:

- **Analytics** covers every till in the store. A terminal's local database only
  knows its own sales, so computing these locally would quietly report a
  fraction of the business. It is the one screen that genuinely needs a
  connection.
- **Return eligibility** is asked of the server for the same reason. A till only
  knows the returns it processed itself, so a locally computed figure goes stale
  the moment another terminal refunds against the same sale — and the cost of
  getting it wrong is refunding a customer twice.

**Everything else that wrote to Supabase is gated.** The remaining
`supabase.from(...)` calls in screens and services sit behind `usingLaravel`
checks, so a Laravel build never reaches Supabase. Writes go through the sync
queue, which is where they belonged anyway.

The one file still calling Supabase unconditionally is `src/sync/syncEngine.ts`,
and that is correct: it *is* the Supabase transport, and `src/sync/index.ts`
never calls it under Laravel.

**Server-side gaps that had to be filled first**, because there was nothing to
migrate onto:

- `MediaController` — store-scoped object paths (`{store_id}/products/{id}.{ext}`),
  read authorised by path prefix, traversal refused. It replaces a Supabase
  bucket that was protected by RLS on `storage.objects`.
- `ReturnHandler` — restocks through the ledger and records the refund as a
  negative payment in the same `payments` table, rather than a parallel refunds
  table that would have to be reconciled against it. Eligibility is re-checked
  across *all* returns for the line, not just the one being processed.
- `SuperAdminController` — provisions a store and its admin in one transaction.
  The Supabase version needed three fallbacks (Edge Function, then RPC, then a
  hand-rolled insert), any of which could leave a store nobody could administer.

---

## Not done

**Conflict resolution has no mobile UI.** Rejected operations are kept with
`status = "conflict"` and `pendingConflicts()` returns them, but nothing renders
them yet. The web till has the full flow — including a manager settling another
till's conflict remotely — and the mobile equivalent is outstanding.

**Not verified on hardware.** Everything above was proven against local servers,
not against a phone on a real network. `HARDWARE-TEST.md` is the procedure, and
Settings → Device Check is the first step of it.

Three things that would have made a first device session unproductive have been
fixed without one:

- **Plain HTTP was blocked before any request left the app.** Android 9+ refuses
  cleartext and iOS refuses it through ATS, so a LAN address over `http://` fails
  at the platform. `app.config.ts` now allows it for non-production builds only.
- **That failure was reported as "offline".** A request that fails while the
  device *has* a network is not the same as having no network, and calling it so
  covered a blocked scheme, a firewall, a server bound to 127.0.0.1 and a wrong
  address — each showing an Offline badge on a phone with four bars.
- **Nothing was reported at all on a Laravel build.** Only the Supabase engine
  wrote to the sync store, so the status stayed idle for ever and the home
  screen's error line never rendered. A till whose sync had failed all day looked
  like one with nothing to send.

---

## Testing a Laravel build

1. Start the backend and seed it.
2. Set the two env vars; `EXPO_PUBLIC_API_URL` must be the machine's LAN address,
   not localhost — on hardware that is the phone itself. The app warns at startup
   if it looks wrong.
3. Sign in with a seeded account. A token lands in the keychain.
4. Ring up a sale offline, reconnect, confirm it reaches the server once.
5. Kill the app mid-sync and reopen: the same operation must be answered
   `duplicate`, and the sale must appear exactly once.

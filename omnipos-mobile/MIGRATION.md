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

`src/sync/index.ts` is the only place the choice is made. Every caller —
the orchestrator, the manual Sync button, the screens — calls `synchronise()`
and knows nothing about which backend answers.

That means retiring Supabase is an edit to one file plus a deletion, not a
rewrite. It also means there are **not** two sync implementations competing:
there is one protocol, spoken by two transports, and only one of them is live at
a time.

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

---

## Not done

**19 files still call Supabase directly** — 41 call sites. They are unaffected
while `EXPO_PUBLIC_BACKEND=supabase`, but a `laravel` build will still reach
Supabase for these, which is why that build is for testing sync and auth only,
not for trading on.

| Area | Files | Replacement |
|---|---|---|
| Analytics | `features/analytics/service.ts` | `GET /api/reports/*` |
| Returns | `features/returns/service.ts`, `returns/stock.ts`, `app/pos/add-return.tsx` | `GET /api/returns`, eligibility endpoint; writes via sync |
| Stock reads | `features/orders/stock.ts` | local ledger; server recomputes |
| Settings & staff | `features/settings/service.ts` | `/api/store`, `/api/store-members`, `/api/store-invites` |
| Stores | `features/stores/service.ts` | `GET /api/stores` |
| Super admin | `features/superAdmin/service.ts` | provisioning endpoints |
| Images | `services/storage.ts` | object storage — **not yet built on the server** |
| Auth bootstrap | `hooks/useAuthBootstrap.ts` | `restoreSession()` in `laravelAuth.ts` |
| Screens | `home.tsx`, `auth/callback.tsx`, `customers/add.tsx`, `order-info.tsx`, `receipt/[id].tsx`, `ImportProductModal.tsx` | read from local DB or the API |

Order of work: auth bootstrap first (it gates everything), then the read-only
services, then returns, then images once the server has somewhere to put them.

**Conflict resolution has no mobile UI.** Rejected operations are kept with
`status = "conflict"` and `pendingConflicts()` returns them, but nothing renders
them yet. The web till has the full flow; the mobile equivalent is outstanding.

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

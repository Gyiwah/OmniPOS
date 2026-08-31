# OmniPOS shared core

This directory implements the two architectural decisions the Supabase → Laravel/PostgreSQL
migration depends on. Both exist so that the mobile app and the forthcoming web/PWA client
run **one** database layer, **one** sync engine and **one** set of business services.

---

## Decision 1 — Records carry a client-minted UUIDv7 as their only identity

`ids/uuidv7.ts` generates time-ordered UUIDs, and `bootstrap.ts` installs it as
WatermelonDB's global ID generator. A record's local primary key is therefore already a
valid server primary key at the moment it is created, offline.

**Why v7 and not v4:** every generated ID becomes a Postgres primary key. v4 scatters
inserts across the B-tree; v7's leading millisecond timestamp keeps them near-sequential on
the hot tables (`orders`, `order_items`, `stock_movements`).

**What this buys the sync protocol:** push becomes a plain idempotent upsert. There is no
"which server row is this local row?" question to answer, so the `remote_id` column, the
SKU-fallback matching and `resolveRemoteProductId()` all become removable.

### The invariant

> A record's local primary key **is** its server primary key.

The sync engine branches on `isUuid(localId)` to decide whether an ID can be used directly
against the server. Before client-minted IDs, locally generated WatermelonDB IDs were never
UUIDs, so that check was implicitly safe. It is now only safe while **every pull path adopts
the server ID as the local primary key** (`rec._raw.id = row.id`). If a pulled row kept an
auto-generated local ID, `isUuid()` would return true for an ID the server has never seen,
and dependent writes would reference a non-existent product.

`src/__tests__/identityInvariant.test.ts` enforces this. Do not weaken it.

### Still outstanding (do at Laravel cutover, not before)

`remote_id` is still written and read — 100+ references — because legacy rows on devices in
the field predate client-minted IDs and the live Supabase sync engine still depends on it.
Remove the column, the SKU-fallback path and `resolveRemoteProductId()` as part of the
cutover, when clients re-pull from Laravel and every local row is reseeded with a server ID.

---

## Decision 2 — The core is platform-agnostic; hosts inject their differences

`platform/` defines the seam. Shared code reaches the host through `PlatformAdapter`
(storage, network, crypto, secure storage, deep links, capability flags) instead of
importing `react-native` or `expo-*`.

| Adapter | Host | Storage | Local DB |
|---|---|---|---|
| `platform/native.ts` | React Native / Expo | AsyncStorage | SQLite (or LokiJS if the native bridge is absent) |
| `platform/web.ts` | Browser / PWA | localStorage | LokiJS over IndexedDB |
| `platform/memory.ts` | Tests, pre-bootstrap | in-memory | in-memory LokiJS |

`createDatabase.ts` picks its WatermelonDB adapter from `platform.capabilities`, so the
database layer loads in a browser build without `react-native` present.

### Registering a platform

Must happen **before** `src/database` is first imported, since that module constructs the
Database at load time. Mobile does this via the first import in the app entry point:

```ts
// index.ts
import "./src/setup/bootstrapNative";  // setPlatform + setGenerator
import "./src/setup/devKeepAwakeShim";
import "expo-router/entry";
```

The web client will import an equivalent module calling
`bootstrapCore(createWebAdapter())`.

### The boundary is enforced, not documented-and-hoped

`src/__tests__/platformBoundary.test.ts` fails the build if anything under `src/core`,
`src/database`, `src/sync`, `src/store`, `src/features`, `src/utils` or `src/services`
imports a platform package directly. A small allowlist covers files that are genuinely
device-bound and will never ship to web (printer, receipt PDF, scanner audio, image upload).

**To use a new host capability, extend `PlatformAdapter` and implement it in each adapter —
do not add an allowlist entry.** Two real leaks (`expo-secure-store` in `encryptionKey.ts`,
`expo-linking` in `settings/service.ts`) were caught by this test and fixed that way.

Note that `secureStorage` is `null` on web: browsers have no keychain equivalent, and
writing key material to `localStorage` would leave it readable by any script on the origin.
Callers must handle null rather than assume a secure store exists.

### Not shared

`src/app` and `src/components` are the mobile UI and still import React Native freely. The
web client builds its own presentation layer against the same core.

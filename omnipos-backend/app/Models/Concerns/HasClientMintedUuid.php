<?php

namespace App\Models\Concerns;

use Illuminate\Database\Eloquent\Concerns\HasUuids;

/**
 * Identity policy for every OmniPOS record.
 *
 * Clients mint UUIDv7 primary keys offline and the server accepts them verbatim,
 * so a record's local key IS its server key. That is what makes the sync push an
 * idempotent upsert instead of a reconciliation problem.
 *
 * Laravel 12's HasUuids generates UUIDv7 (Str::uuid7) and only does so when the
 * model does not already have a key — which is exactly the behaviour needed.
 * Server-originated records (a store created in the web admin) get a v7 key here,
 * while client-originated records keep the key the device already wrote to its
 * own database and printed on a receipt.
 *
 * Note this is NOT Laravel's HasVersion4Uuids, which is the legacy v4 trait. v7
 * matters because these are Postgres primary keys: the leading millisecond
 * timestamp keeps inserts near-sequential in the B-tree on the hot tables
 * instead of scattering them.
 *
 * Aliased behind our own trait name so the identity policy has one documented
 * home, and so swapping the underlying implementation touches one file.
 */
trait HasClientMintedUuid
{
    use HasUuids;
}

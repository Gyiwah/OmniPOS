<?php

namespace App\Services\Sync;

use App\Models\Device;
use App\Models\User;

/**
 * One implementation per syncable entity.
 *
 * Handlers must be safe to run twice with the same record_id: SyncService's
 * idempotency ledger catches repeats of the same operation_id, but a client may
 * legitimately send two different operations that touch one record, and an
 * upsert must converge either way.
 */
interface EntityHandler
{
    /** Can this user perform this action on this store? Mirrors the old RLS policy. */
    public function authorize(User $user, string $storeId, string $action, array $payload): bool;

    public function upsert(string $storeId, string $recordId, array $payload, User $user, ?Device $device): UpsertOutcome;

    public function delete(string $storeId, string $recordId, User $user, ?Device $device): UpsertOutcome;
}

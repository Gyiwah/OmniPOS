<?php

namespace App\Services\Sync;

use App\Models\Device;
use App\Models\SyncChange;
use App\Models\SyncConflict;
use App\Models\SyncOperation;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Throwable;

/**
 * Push/pull synchronisation for the mobile and web clients.
 *
 * Two guarantees this class exists to provide:
 *
 * 1. PUSH IS IDEMPOTENT. A client that loses connectivity after the server
 *    committed cannot tell whether its write landed, so it retries. Every
 *    operation carries a client-generated operation_id, recorded under a unique
 *    index. A repeat is answered from the stored result and never re-applied —
 *    otherwise a retried checkout books the sale twice and the day's takings are
 *    wrong.
 *
 * 2. PULL NEVER SKIPS A CHANGE. Clients track a cursor over sync_changes.sequence.
 *    See stabilityCutoff() below for the ordering hazard this has to work around.
 */
class SyncService
{
    public function __construct(
        private readonly EntityResolver $entities,
    ) {
    }

    /**
     * Apply a batch of client operations.
     *
     * Each operation is committed in its own transaction. A batch-wide
     * transaction would be wrong here: one bad operation (a duplicate order
     * number, a product deleted on another till) would roll back every good sale
     * sent alongside it, and the client would have no way to make progress.
     *
     * @param  array<int, array<string, mixed>>  $operations
     * @return array{applied: int, duplicates: int, conflicts: int, failed: int, results: array<int, array<string, mixed>>}
     */
    public function push(string $storeId, User $user, ?Device $device, array $operations): array
    {
        $summary = ['applied' => 0, 'duplicates' => 0, 'conflicts' => 0, 'failed' => 0, 'results' => []];

        // Ensure parent entities (products, categories, stores) apply before dependent entities (batches, movements, orders)
        $priority = [
            'stores' => 1,
            'categories' => 1,
            'users' => 1,
            'customers' => 1,
            'products' => 1,
            'product_batches' => 2,
            'register_shifts' => 2,
            'stock_movements' => 3,
            'orders' => 3,
            'order_items' => 4,
            'payments' => 4,
            'price_history' => 4,
        ];

        usort($operations, function ($a, $b) use ($priority) {
            $entityA = $a['entity'] ?? $a['table'] ?? '';
            $entityB = $b['entity'] ?? $b['table'] ?? '';
            $pA = $priority[$entityA] ?? 10;
            $pB = $priority[$entityB] ?? 10;

            return $pA <=> $pB;
        });

        foreach ($operations as $operation) {
            $result = $this->applyOne($storeId, $user, $device, $operation);
            $summary['results'][] = $result;

            $bucket = match ($result['status']) {
                SyncOperation::STATUS_APPLIED => 'applied',
                SyncOperation::STATUS_DUPLICATE => 'duplicates',
                SyncOperation::STATUS_CONFLICT => 'conflicts',
                default => 'failed',
            };
            $summary[$bucket]++;
        }

        $device?->forceFill(['last_seen_at' => now()])->save();

        return $summary;
    }

    /**
     * @param  array<string, mixed>  $operation
     * @return array<string, mixed>
     */
    private function applyOne(string $storeId, User $user, ?Device $device, array $operation): array
    {
        $operationId = $operation['operation_id'] ?? null;
        $entity = $operation['entity'] ?? $operation['table'] ?? null;
        $action = $operation['action'] ?? 'upsert';
        $recordId = $operation['record_id'] ?? ($operation['payload']['id'] ?? null);
        $payload = $operation['payload'] ?? [];

        if (! $operationId || ! $entity || ! $recordId) {
            return $this->failure($operationId, 'operation_id, entity and record_id are all required.');
        }

        // Fast path for a retry we have already answered.
        $existing = SyncOperation::where('operation_id', $operationId)->first();
        if ($existing) {
            return [
                'operation_id' => $operationId,
                'status' => SyncOperation::STATUS_DUPLICATE,
                'record_id' => $existing->record_id,
                'result' => $existing->result,
            ];
        }

        if (! $this->entities->supports($entity)) {
            return $this->failure($operationId, "Unknown entity [{$entity}].");
        }

        try {
            return DB::transaction(function () use (
                $storeId, $user, $device, $operationId, $entity, $action, $recordId, $payload
            ) {
                $handler = $this->entities->for($entity);

                if (! $handler->authorize($user, $storeId, $action, $payload)) {
                    return $this->conflict(
                        $operationId, $storeId, $device, $entity, $recordId, $payload,
                        'Your role does not permit this operation.'
                    );
                }

                $outcome = $action === 'delete'
                    ? $handler->delete($storeId, $recordId, $user, $device)
                    : $handler->upsert($storeId, $recordId, $payload, $user, $device);

                if ($outcome->isConflict()) {
                    return $this->conflict(
                        $operationId, $storeId, $device, $entity, $recordId, $payload,
                        $outcome->reason, $outcome->serverState
                    );
                }

                // Recording the operation and publishing the change happen inside
                // the same transaction as the write itself. If any part fails the
                // whole thing rolls back, so the idempotency ledger can never claim
                // an operation was applied when it was not.
                SyncOperation::create([
                    'operation_id' => $operationId,
                    'store_id' => $storeId,
                    'device_id' => $device?->id,
                    'user_id' => $user->id,
                    'entity' => $entity,
                    'record_id' => $recordId,
                    'action' => $action,
                    'status' => SyncOperation::STATUS_APPLIED,
                    'result' => $outcome->result,
                    'client_created_at' => $payload['client_created_at'] ?? null,
                    'processed_at' => now(),
                ]);

                SyncChange::create([
                    'store_id' => $storeId,
                    'entity' => $entity,
                    'record_id' => $recordId,
                    'action' => $action === 'delete' ? 'delete' : 'upsert',
                    'payload' => $outcome->result ?? [],
                    'origin_device_id' => $device?->id,
                ]);

                return [
                    'operation_id' => $operationId,
                    'status' => SyncOperation::STATUS_APPLIED,
                    'record_id' => $recordId,
                    'result' => $outcome->result,
                ];
            });
        } catch (Throwable $e) {
            // A unique violation on operation_id means two concurrent requests
            // carried the same operation — the retry case, won by the other one.
            if ($this->isDuplicateOperation($e)) {
                $winner = SyncOperation::where('operation_id', $operationId)->first();

                return [
                    'operation_id' => $operationId,
                    'status' => SyncOperation::STATUS_DUPLICATE,
                    'record_id' => $winner?->record_id ?? $recordId,
                    'result' => $winner?->result,
                ];
            }

            Log::error('Sync operation failed', [
                'operation_id' => $operationId,
                'entity' => $entity,
                'store_id' => $storeId,
                'exception' => $e->getMessage(),
            ]);

            return $this->failure($operationId, 'The operation could not be applied.', $recordId);
        }
    }

    /**
     * Apply a payload the server already holds, on someone's behalf.
     *
     * Used when a manager settles a conflict raised by a different till. The
     * corrected data cannot come from their device — they never had that sale —
     * so it comes from the conflict record, which stored the client's payload
     * when the push was rejected.
     *
     * It runs through the same entity handler a push would, so there is still
     * exactly one implementation of the money path. The operation is recorded
     * with a server-generated id and published to the changefeed, which is how
     * the originating till discovers its sale was booked after all.
     *
     * @return array{ok: bool, reason?: string, server_state?: array|null, result?: array|null}
     */
    public function applyOnBehalf(
        string $storeId,
        User $user,
        string $entity,
        string $recordId,
        array $payload,
    ): array {
        if (! $this->entities->supports($entity)) {
            return ['ok' => false, 'reason' => "Unknown entity [{$entity}]."];
        }

        return DB::transaction(function () use ($storeId, $user, $entity, $recordId, $payload) {
            $handler = $this->entities->for($entity);

            if (! $handler->authorize($user, $storeId, 'upsert', $payload)) {
                return ['ok' => false, 'reason' => 'Your role does not permit this operation.'];
            }

            $outcome = $handler->upsert($storeId, $recordId, $payload, $user, null);

            if ($outcome->isConflict()) {
                return [
                    'ok' => false,
                    'reason' => $outcome->reason,
                    'server_state' => $outcome->serverState,
                ];
            }

            $operationId = (string) Str::uuid7();

            SyncOperation::create([
                'operation_id' => $operationId,
                'store_id' => $storeId,
                'device_id' => null,
                'user_id' => $user->id,
                'entity' => $entity,
                'record_id' => $recordId,
                'action' => 'upsert',
                'status' => SyncOperation::STATUS_APPLIED,
                'result' => $outcome->result,
                'processed_at' => now(),
            ]);

            // origin_device_id is null on purpose: no device originated this, so
            // every till including the one that raised the conflict must receive
            // it. That is how the originating till learns to clear its queue.
            SyncChange::create([
                'store_id' => $storeId,
                'entity' => $entity,
                'record_id' => $recordId,
                'action' => 'upsert',
                'payload' => $outcome->result ?? [],
                'origin_device_id' => null,
            ]);

            return ['ok' => true, 'result' => $outcome->result];
        });
    }

    /**
     * Changes after $cursor, oldest first.
     *
     * @return array{cursor: int, changes: array<int, array<string, mixed>>, has_more: bool}
     */
    public function pull(string $storeId, int $cursor, int $limit = 500, ?Device $device = null, bool $includeOwn = false): array
    {
        $limit = max(1, min($limit, 1000));

        $query = SyncChange::query()
            ->where('store_id', $storeId)
            ->where('sequence', '>', $cursor)
            ->where('created_at', '<=', $this->stabilityCutoff())
            ->orderBy('sequence')
            ->limit($limit + 1);

        // A device has already applied its own writes locally, so echoing them
        // back wastes bandwidth and risks clobbering newer local edits.
        if ($device && ! $includeOwn) {
            $query->where(function ($q) use ($device) {
                $q->whereNull('origin_device_id')->orWhere('origin_device_id', '!=', $device->id);
            });
        }

        $rows = $query->get();
        $hasMore = $rows->count() > $limit;
        $rows = $rows->take($limit);

        $next = $rows->last()?->sequence ?? $cursor;

        if ($device && $next > $device->last_pull_sequence) {
            $device->forceFill(['last_pull_sequence' => $next, 'last_seen_at' => now()])->save();
        }

        return [
            'cursor' => (int) $next,
            'has_more' => $hasMore,
            'changes' => $rows->map(fn (SyncChange $c) => [
                'sequence' => (int) $c->sequence,
                'entity' => $c->entity,
                'action' => $c->action,
                'record_id' => $c->record_id,
                'payload' => $c->payload,
                'created_at' => $c->created_at?->toIso8601String(),
            ])->values()->all(),
        ];
    }

    /**
     * Why pulls exclude the most recent moment of history.
     *
     * bigserial hands out sequence numbers at INSERT time, but rows become
     * visible at COMMIT time, and those orders differ. Transaction A can take
     * sequence 100, transaction B take 101 and commit first. A client reading
     * "everything above my cursor of 99" would see 101, advance its cursor to
     * 101, and never see 100 when it commits a moment later. The change is lost
     * permanently — and in this system a lost change is a lost sale or a stock
     * movement that never applies.
     *
     * Only serving rows older than a short window lets every in-flight
     * transaction commit before its sequence becomes readable. The cost is that
     * changes arrive a second late, which is irrelevant for a system whose
     * clients are frequently offline for hours.
     *
     * The rigorous alternative is pg_snapshot_xmin(pg_current_snapshot()) to find
     * the oldest still-running transaction and serve strictly below it. Worth
     * adopting if the window ever proves too coarse; it removes the guesswork.
     */
    private function stabilityCutoff(): \Illuminate\Support\Carbon
    {
        $windowMs = (int) config('omnipos.sync.stability_window_ms', 1000);

        return now()->subMilliseconds($windowMs);
    }

    /** @return array<string, mixed> */
    private function conflict(
        string $operationId,
        string $storeId,
        ?Device $device,
        string $entity,
        string $recordId,
        array $payload,
        string $reason,
        ?array $serverState = null
    ): array {
        SyncOperation::create([
            'operation_id' => $operationId,
            'store_id' => $storeId,
            'device_id' => $device?->id,
            'entity' => $entity,
            'record_id' => $recordId,
            'action' => 'upsert',
            'status' => SyncOperation::STATUS_CONFLICT,
            'error' => $reason,
            'processed_at' => now(),
        ]);

        SyncConflict::create([
            'operation_id' => $operationId,
            'store_id' => $storeId,
            'device_id' => $device?->id,
            'entity' => $entity,
            'record_id' => $recordId,
            'reason' => $reason,
            'client_payload' => $payload,
            'server_state' => $serverState,
        ]);

        return [
            'operation_id' => $operationId,
            'status' => SyncOperation::STATUS_CONFLICT,
            'record_id' => $recordId,
            'reason' => $reason,
            'server_state' => $serverState,
        ];
    }

    /** @return array<string, mixed> */
    private function failure(?string $operationId, string $message, ?string $recordId = null): array
    {
        return [
            'operation_id' => $operationId,
            'status' => SyncOperation::STATUS_FAILED,
            'record_id' => $recordId,
            'reason' => $message,
        ];
    }

    private function isDuplicateOperation(Throwable $e): bool
    {
        return $e instanceof \Illuminate\Database\UniqueConstraintViolationException
            || str_contains($e->getMessage(), 'sync_operations_operation_id_unique');
    }
}

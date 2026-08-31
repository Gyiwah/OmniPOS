<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Api\Concerns\ScopesToStore;
use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\Order;
use App\Models\SyncConflict;
use App\Services\Sync\SyncService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Conflicts a manager has to settle.
 *
 * A conflict is money that has already changed hands but that the server could
 * not book as sent — most often two offline tills issuing the same receipt
 * number. The client keeps its own copy so the till can still reprint, but the
 * decision about what should happen belongs to whoever is accountable for the
 * books, from whichever device they are on. That is why this reads across the
 * whole store rather than one terminal's local queue.
 */
class SyncConflictController extends Controller
{
    use ScopesToStore;

    /** GET /api/sync/conflicts — query: resolution (default: pending) */
    public function index(Request $request): JsonResponse
    {
        $query = SyncConflict::where('store_id', $this->storeId($request));

        $resolution = $request->query('resolution', 'pending');
        if ($resolution !== 'all') {
            $query->where('resolution', $resolution);
        }

        $conflicts = $query->latest('id')->limit(200)->get();

        return response()->json([
            'data' => $conflicts->map(fn (SyncConflict $c) => [
                'id' => $c->id,
                'operation_id' => $c->operation_id,
                'entity' => $c->entity,
                'record_id' => $c->record_id,
                'reason' => $c->reason,
                'resolution' => $c->resolution,
                // Both sides are returned so a manager can compare what this till
                // believed against what the server already held.
                'client_payload' => $c->client_payload,
                'server_state' => $c->server_state,
                'device_id' => $c->device_id,
                'created_at' => $c->created_at?->toIso8601String(),
                'resolved_at' => $c->resolved_at?->toIso8601String(),
            ]),
            'pending_count' => SyncConflict::where('store_id', $this->storeId($request))
                ->where('resolution', 'pending')->count(),
        ]);
    }

    /**
     * POST /api/sync/conflicts/{operationId}/resolve
     *
     * Addressed by operation_id, not by the conflict row's own id. The client
     * generated the operation_id and has it to hand; it never learns the
     * server's row id, so that is the only identifier both sides share.
     *
     * Two actions, and the difference matters:
     *
     *   acknowledge — the originating till has already fixed and re-pushed this
     *       itself. Nothing is applied here; the row is just marked settled so
     *       two managers do not work the same problem.
     *
     *   reissue — book the sale from the payload the server kept when the push
     *       was rejected, under a receipt number that is free. This is what lets
     *       a manager settle a conflict raised by a DIFFERENT till: the
     *       corrected data cannot come from their device, because they never had
     *       that sale.
     *
     *   discard — the sale should not be booked at all.
     */
    public function resolve(Request $request, string $operationId, SyncService $sync): JsonResponse
    {
        $storeId = $this->storeId($request);

        $model = SyncConflict::where('store_id', $storeId)
            ->where('operation_id', $operationId)
            ->firstOrFail();

        if ($model->resolution !== 'pending') {
            return response()->json([
                'message' => 'This conflict was already settled.',
                'resolution' => $model->resolution,
                'resolved_at' => $model->resolved_at?->toIso8601String(),
            ], 409);
        }

        $data = $request->validate([
            'action' => ['required', Rule::in(['reissue', 'discard', 'acknowledge'])],
            'note' => ['nullable', 'string', 'max:500'],
        ]);

        $applied = null;

        if ($data['action'] === 'reissue') {
            $outcome = $this->reissue($storeId, $model, $request, $sync);

            if (! $outcome['ok']) {
                // Left pending on purpose. A conflict that cannot be settled is
                // still a conflict, and marking it resolved would hide money.
                return response()->json([
                    'message' => $outcome['reason'] ?? 'Could not re-issue this sale.',
                    'server_state' => $outcome['server_state'] ?? null,
                ], 422);
            }

            $applied = $outcome['result'];
        }

        $resolution = match ($data['action']) {
            'reissue' => 'merged',
            'discard' => 'server_wins',
            default => 'client_wins',
        };

        $model->forceFill([
            'resolution' => $resolution,
            'resolved_by_user_id' => $request->user()->id,
            'resolved_at' => now(),
        ])->save();

        // Someone decided what happened to a sale. That is exactly the kind of
        // judgement call a business needs to be able to look back at.
        AuditLog::create([
            'store_id' => $model->store_id,
            'user_id' => $request->user()->id,
            'action' => 'sync.conflict_resolved',
            'entity_type' => $model->entity,
            'entity_id' => $model->record_id,
            'before' => ['resolution' => 'pending', 'reason' => $model->reason],
            'after' => [
                'action' => $data['action'],
                'resolution' => $resolution,
                'note' => $data['note'] ?? null,
                'booked_as' => $applied['order_number'] ?? null,
            ],
            'ip_address' => $request->ip(),
            'user_agent' => $request->userAgent(),
        ]);

        return response()->json([
            'id' => $model->id,
            'action' => $data['action'],
            'resolution' => $model->resolution,
            'resolved_at' => $model->resolved_at?->toIso8601String(),
            'booked_as' => $applied['order_number'] ?? null,
        ]);
    }

    /**
     * Re-apply the stored payload under a free receipt number.
     *
     * The number is taken from the server's own view, because that is the whole
     * point: the till that raised this conflict could not know which numbers the
     * other tills had used.
     */
    private function reissue(string $storeId, SyncConflict $conflict, Request $request, SyncService $sync): array
    {
        $payload = $conflict->client_payload ?? [];

        if (! $payload) {
            return ['ok' => false, 'reason' => 'This conflict has no stored payload to re-issue.'];
        }

        if ($conflict->entity === 'orders') {
            $payload['order_number'] = $this->nextFreeOrderNumber($storeId);
        }

        return $sync->applyOnBehalf(
            $storeId,
            $request->user(),
            $conflict->entity,
            $conflict->record_id,
            $payload,
        );
    }

    /** Zero-padded suffixes sort lexically, so the lexical max is the numeric max. */
    private function nextFreeOrderNumber(string $storeId): string
    {
        $prefix = 'OM-'.now()->format('Ymd').'-';

        $highest = Order::withTrashed()
            ->where('store_id', $storeId)
            ->where('order_number', 'like', $prefix.'%')
            ->max('order_number');

        $sequence = $highest ? (int) substr($highest, strlen($prefix)) : 0;

        return $prefix.str_pad((string) ($sequence + 1), 4, '0', STR_PAD_LEFT);
    }
}

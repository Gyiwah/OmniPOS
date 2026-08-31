<?php

namespace App\Services\Sync\Handlers;

use App\Models\Device;
use App\Models\RegisterShift;
use App\Models\StoreMember;
use App\Models\User;
use App\Services\Sync\EntityHandler;
use App\Services\Sync\UpsertOutcome;

/**
 * Cash drawer sessions.
 *
 * The mobile client has been enqueueing these since the shifts feature landed,
 * but Supabase had no register_shifts table, so every one of those operations
 * failed. This handler is the first server-side home they have had.
 */
class RegisterShiftHandler implements EntityHandler
{
    public function authorize(User $user, string $storeId, string $action, array $payload): bool
    {
        if ($action === 'delete') {
            return false;
        }

        return $user->hasStoreRole($storeId, [
            StoreMember::ROLE_ADMIN,
            StoreMember::ROLE_MANAGER,
            StoreMember::ROLE_CASHIER,
        ]);
    }

    public function upsert(string $storeId, string $recordId, array $payload, User $user, ?Device $device): UpsertOutcome
    {
        $shift = RegisterShift::find($recordId);

        if ($shift && $shift->store_id !== $storeId) {
            return UpsertOutcome::conflict('Record belongs to a different store.');
        }

        // A closed shift is a signed-off cash count. Reopening it from a stale
        // device would let a cashier revise a drawer reconciliation after the
        // fact, so late edits are refused rather than merged.
        if ($shift && $shift->status === 'closed' && ($payload['status'] ?? null) === 'open') {
            return UpsertOutcome::conflict(
                'This shift is already closed and cannot be reopened.',
                ['closed_at' => $shift->closed_at, 'discrepancy' => $shift->discrepancy]
            );
        }

        $cashierId = $payload['cashier_user_id'] ?? $user->id;
        $status = $payload['status'] ?? 'open';

        // The partial unique index allows only one open shift per cashier per
        // store; check first so the client gets a conflict it can explain rather
        // than a database error.
        if ($status === 'open') {
            $openElsewhere = RegisterShift::where('store_id', $storeId)
                ->where('cashier_user_id', $cashierId)
                ->where('status', 'open')
                ->whereKeyNot($recordId)
                ->first();

            if ($openElsewhere) {
                return UpsertOutcome::conflict(
                    'This cashier already has an open shift.',
                    ['id' => $openElsewhere->id, 'opened_at' => $openElsewhere->opened_at]
                );
            }
        }

        $shift ??= new RegisterShift();
        $shift->forceFill([
            'id' => $recordId,
            'store_id' => $storeId,
            'cashier_user_id' => $cashierId,
            'device_id' => $device?->id,
            'opened_at' => $payload['opened_at'] ?? now(),
            'closed_at' => $payload['closed_at'] ?? null,
            'opening_float' => $payload['opening_float'] ?? 0,
            'cash_in' => $payload['cash_in'] ?? 0,
            'cash_out' => $payload['cash_out'] ?? 0,
            'actual_cash' => $payload['actual_cash'] ?? null,
            'status' => $status,
            'notes' => $payload['notes'] ?? null,
            'movements_json' => $payload['movements'] ?? $payload['movements_json'] ?? [],
        ]);
        $shift->save();

        // Recomputed from the payments ledger rather than taken from the client:
        // a terminal that synced late would otherwise understate the till.
        $expected = $shift->computeExpectedCash();
        $shift->forceFill([
            'cash_sales' => (string) $shift->payments()->cash()->sum('amount'),
            'expected_cash' => $expected,
            'discrepancy' => $shift->actual_cash !== null
                ? bcsub((string) $shift->actual_cash, $expected, 2)
                : null,
        ])->save();

        return UpsertOutcome::applied($shift->fresh()->toArray());
    }

    public function delete(string $storeId, string $recordId, User $user, ?Device $device): UpsertOutcome
    {
        return UpsertOutcome::conflict('Register shifts cannot be deleted.');
    }
}

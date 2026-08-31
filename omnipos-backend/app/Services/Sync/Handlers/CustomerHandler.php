<?php

namespace App\Services\Sync\Handlers;

use App\Models\Customer;
use App\Models\Device;
use App\Models\StoreMember;
use App\Models\User;
use App\Services\Sync\EntityHandler;
use App\Services\Sync\UpsertOutcome;

class CustomerHandler implements EntityHandler
{
    public function authorize(User $user, string $storeId, string $action, array $payload): bool
    {
        if ($action === 'delete') {
            return $user->hasStoreRole($storeId, [StoreMember::ROLE_ADMIN, StoreMember::ROLE_MANAGER]);
        }

        // Cashiers register customers at the till, as they do in the mobile app.
        return $user->hasStoreRole($storeId, [
            StoreMember::ROLE_ADMIN,
            StoreMember::ROLE_MANAGER,
            StoreMember::ROLE_CASHIER,
        ]);
    }

    public function upsert(string $storeId, string $recordId, array $payload, User $user, ?Device $device): UpsertOutcome
    {
        $existing = Customer::withTrashed()->find($recordId);

        if ($existing && $existing->store_id !== $storeId) {
            return UpsertOutcome::conflict('Record belongs to a different store.');
        }

        $attributes = array_filter([
            'store_id' => $storeId,
            'name' => $payload['name'] ?? null,
            'phone' => $payload['phone'] ?? null,
            'email' => $payload['email'] ?? null,
            'notes' => $payload['notes'] ?? null,
        ], fn ($v) => $v !== null);

        // total_spend and outstanding_balance are deliberately not accepted from
        // the client. They are derived from orders and payments; taking a
        // device's figure would let a terminal that synced late reinstate a debt
        // the customer already settled at another till.
        $customer = Customer::withTrashed()->firstOrNew(['id' => $recordId]);
        $customer->forceFill(array_merge($attributes, ['id' => $recordId]));

        if ($customer->trashed()) {
            $customer->deleted_at = null;
        }

        $customer->save();

        return UpsertOutcome::applied($customer->fresh()->toArray());
    }

    public function delete(string $storeId, string $recordId, User $user, ?Device $device): UpsertOutcome
    {
        $customer = Customer::where('store_id', $storeId)->find($recordId);

        if ($customer && bccomp((string) $customer->outstanding_balance, '0', 2) === 1) {
            return UpsertOutcome::conflict(
                'Customer has an outstanding balance and cannot be deleted.',
                ['outstanding_balance' => $customer->outstanding_balance]
            );
        }

        $customer?->delete();

        return UpsertOutcome::applied(['id' => $recordId, 'deleted' => true]);
    }
}

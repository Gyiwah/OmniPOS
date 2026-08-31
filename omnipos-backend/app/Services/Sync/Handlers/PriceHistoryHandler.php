<?php

namespace App\Services\Sync\Handlers;

use App\Models\Device;
use App\Models\PriceHistory;
use App\Models\Product;
use App\Models\StoreMember;
use App\Models\User;
use App\Services\Sync\EntityHandler;
use App\Services\Sync\UpsertOutcome;

/**
 * Append-only record of price changes. Only roles that may change a price can
 * write history for it.
 */
class PriceHistoryHandler implements EntityHandler
{
    public function authorize(User $user, string $storeId, string $action, array $payload): bool
    {
        return $action !== 'delete'
            && $user->hasStoreRole($storeId, [StoreMember::ROLE_ADMIN, StoreMember::ROLE_MANAGER]);
    }

    public function upsert(string $storeId, string $recordId, array $payload, User $user, ?Device $device): UpsertOutcome
    {
        $productId = $payload['product_id'] ?? null;

        if (! $productId || ! Product::where('store_id', $storeId)->whereKey($productId)->exists()) {
            return UpsertOutcome::conflict('Product not found in this store.', ['product_id' => $productId]);
        }

        $existing = PriceHistory::find($recordId);
        if ($existing) {
            return UpsertOutcome::applied($existing->toArray());
        }

        $entry = PriceHistory::create([
            'id' => $recordId,
            'store_id' => $storeId,
            'product_id' => $productId,
            'user_id' => $user->id,
            'old_sell_price' => $payload['old_sell_price'] ?? 0,
            'new_sell_price' => $payload['new_sell_price'] ?? 0,
            'old_cost_price' => $payload['old_cost_price'] ?? null,
            'new_cost_price' => $payload['new_cost_price'] ?? null,
            'reason' => $payload['reason'] ?? null,
            'client_created_at' => $payload['client_created_at'] ?? null,
        ]);

        return UpsertOutcome::applied($entry->toArray());
    }

    public function delete(string $storeId, string $recordId, User $user, ?Device $device): UpsertOutcome
    {
        return UpsertOutcome::conflict('Price history is immutable.');
    }
}

<?php

namespace App\Services\Sync\Handlers;

use App\Models\Device;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\StoreMember;
use App\Models\User;
use App\Services\Sync\EntityHandler;
use App\Services\Sync\UpsertOutcome;

class ProductBatchHandler implements EntityHandler
{
    public function authorize(User $user, string $storeId, string $action, array $payload): bool
    {
        return $user->hasStoreRole($storeId, [
            StoreMember::ROLE_ADMIN,
            StoreMember::ROLE_MANAGER,
            StoreMember::ROLE_CASHIER,
        ]);
    }

    public function upsert(string $storeId, string $recordId, array $payload, User $user, ?Device $device): UpsertOutcome
    {
        $productId = $payload['product_id'] ?? null;
        if (! $productId) {
            return UpsertOutcome::conflict('product_id is required.');
        }

        if (! Product::where('store_id', $storeId)->whereKey($productId)->exists()) {
            return UpsertOutcome::conflict('Product not found in this store.', ['product_id' => $productId]);
        }

        $batchNumber = $payload['batch_number'] ?? null;
        if (! $batchNumber) {
            return UpsertOutcome::conflict('batch_number is required.');
        }

        $clash = ProductBatch::withTrashed()
            ->where('store_id', $storeId)
            ->where('product_id', $productId)
            ->where('batch_number', $batchNumber)
            ->whereKeyNot($recordId)
            ->first();

        if ($clash) {
            return UpsertOutcome::conflict(
                "Batch [{$batchNumber}] already exists for this product.",
                ['id' => $clash->id, 'quantity' => $clash->quantity]
            );
        }

        $batch = ProductBatch::withTrashed()->firstOrNew(['id' => $recordId]);
        $batch->forceFill([
            'id' => $recordId,
            'store_id' => $storeId,
            'product_id' => $productId,
            'batch_number' => $batchNumber,
            'quantity' => $payload['quantity'] ?? 0,
            'cost_price' => $payload['cost_price'] ?? null,
            'expiry_date' => $payload['expiry_date'] ?? null,
        ]);

        if ($batch->trashed()) {
            $batch->deleted_at = null;
        }

        $batch->save();

        return UpsertOutcome::applied($batch->fresh()->toArray());
    }

    public function delete(string $storeId, string $recordId, User $user, ?Device $device): UpsertOutcome
    {
        ProductBatch::where('store_id', $storeId)->find($recordId)?->delete();

        return UpsertOutcome::applied(['id' => $recordId, 'deleted' => true]);
    }
}

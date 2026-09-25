<?php

namespace App\Services\Sync\Handlers;

use App\Models\Device;
use App\Models\Product;
use App\Models\StoreMember;
use App\Models\User;
use App\Services\Sync\EntityHandler;
use App\Services\Sync\UpsertOutcome;

class ProductHandler implements EntityHandler
{
    public function authorize(User $user, string $storeId, string $action, array $payload): bool
    {
        return $user->hasStoreRole($storeId, [StoreMember::ROLE_ADMIN, StoreMember::ROLE_MANAGER]);
    }

    public function upsert(string $storeId, string $recordId, array $payload, User $user, ?Device $device): UpsertOutcome
    {
        $existing = Product::withTrashed()->find($recordId);

        // A record id that already belongs to another tenant is not a conflict to
        // reconcile, it is a cross-tenant write attempt. Refuse it outright.
        if ($existing && $existing->store_id !== $storeId) {
            return UpsertOutcome::conflict('Record belongs to a different store.');
        }

        $sku = $payload['sku'] ?? $existing?->sku;
        if (! $sku) {
            return UpsertOutcome::conflict('sku is required.');
        }

        // SKU is unique per store. Two tills that created "SKU-1" while offline
        // produce a genuine clash a human has to settle, so surface it rather
        // than renaming one silently.
        $skuOwner = Product::withTrashed()
            ->where('store_id', $storeId)
            ->where('sku', $sku)
            ->whereKeyNot($recordId)
            ->first();

        if ($skuOwner) {
            return UpsertOutcome::conflict(
                "SKU [{$sku}] is already used by another product in this store.",
                ['id' => $skuOwner->id, 'name' => $skuOwner->name, 'sku' => $skuOwner->sku]
            );
        }

        $categoryId = ! empty($payload['category_id']) ? $payload['category_id'] : null;
        if ($categoryId && ! \App\Models\Category::where('store_id', $storeId)->whereKey($categoryId)->exists()) {
            $categoryId = null;
        }

        $attributes = array_filter([
            'store_id' => $storeId,
            'name' => $payload['name'] ?? null,
            'sku' => $sku,
            'barcode' => $payload['barcode'] ?? null,
            'price' => $payload['price'] ?? $payload['sell_price'] ?? null,
            'cost_price' => $payload['cost_price'] ?? null,
            'reorder_level' => $payload['reorder_level'] ?? null,
            'image_url' => $payload['image_url'] ?? null,
            'tags' => $payload['tags'] ?? null,
            'expiry_date' => $payload['expiry_date'] ?? null,
            'category_id' => $categoryId,
            'is_active' => $payload['is_active'] ?? null,
        ], fn ($v) => $v !== null);

        $product = Product::withTrashed()->firstOrNew(['id' => $recordId]);
        $isNew = ! $product->exists;
        $initialStock = (int) ($payload['stock'] ?? $payload['initial_stock'] ?? 0);

        if ($isNew) {
            if (! isset($attributes['price'])) {
                $attributes['price'] = 0.00;
            }
            if ($initialStock > 0) {
                $attributes['stock'] = $initialStock;
            }
        }

        $product->forceFill(array_merge($attributes, ['id' => $recordId]));

        if ($product->trashed()) {
            $product->deleted_at = null;
        }

        $product->save();

        // Ensure stock attribute stays in sync with ledger balance
        $inventory = app(\App\Services\InventoryService::class);
        $movementCount = $product->movements()->count();

        if ($movementCount === 0 && (int) $product->stock > 0) {
            $inventory->recordOpeningBalance($product);
        } else if ($movementCount > 0) {
            $product->forceFill(['stock' => (int) round($inventory->ledgerBalance($product->id))])->save();
        }

        return UpsertOutcome::applied($product->fresh()->toArray());
    }

    public function delete(string $storeId, string $recordId, User $user, ?Device $device): UpsertOutcome
    {
        $product = Product::where('store_id', $storeId)->find($recordId);

        if (! $product) {
            // Already gone. Deleting twice is success, not failure — otherwise a
            // retried delete would report a conflict for ever.
            return UpsertOutcome::applied(['id' => $recordId, 'deleted' => true]);
        }

        $product->delete();

        return UpsertOutcome::applied(['id' => $recordId, 'deleted' => true]);
    }
}

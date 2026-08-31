<?php

namespace App\Services\Sync\Handlers;

use App\Models\Device;
use App\Models\Product;
use App\Models\StoreMember;
use App\Models\User;
use App\Services\InventoryService;
use App\Services\Sync\EntityHandler;
use App\Services\Sync\UpsertOutcome;

/**
 * Stock adjustments made directly on a device (stock takes, damages, expiries,
 * goods received). Sales post their own movements through OrderHandler.
 */
class StockMovementHandler implements EntityHandler
{
    public function __construct(private readonly InventoryService $inventory)
    {
    }

    public function authorize(User $user, string $storeId, string $action, array $payload): bool
    {
        // Cashiers may move stock but not delete the record of having done so.
        return $action !== 'delete' && $user->hasStoreRole($storeId, [
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

        $product = Product::where('store_id', $storeId)->find($productId);
        if (! $product) {
            // The product was deleted on another device before this movement
            // arrived. Recorded as a conflict so the adjustment is not simply
            // lost — someone counted something that the catalogue no longer has.
            return UpsertOutcome::conflict('Product not found in this store.', ['product_id' => $productId]);
        }

        $quantity = (float) ($payload['quantity'] ?? 0);
        if ($quantity === 0.0) {
            return UpsertOutcome::conflict('quantity must be non-zero.');
        }

        $movement = $this->inventory->recordMovement(
            movementId: $recordId,
            product: $product,
            type: $payload['type'] ?? 'ADJUSTMENT',
            quantity: $quantity,
            reason: $payload['reason'] ?? 'Adjustment',
            user: $user,
            device: $device,
            sourceType: $payload['source_type'] ?? null,
            sourceId: $payload['source_id'] ?? null,
            batchId: $payload['batch_id'] ?? null,
            notes: $payload['notes'] ?? null,
            clientCreatedAt: $payload['client_created_at'] ?? null,
        );

        return UpsertOutcome::applied($movement->toArray());
    }

    public function delete(string $storeId, string $recordId, User $user, ?Device $device): UpsertOutcome
    {
        // The ledger is append-only. Reversing an adjustment means posting an
        // opposing movement, never erasing the original.
        return UpsertOutcome::conflict('Stock movements are immutable; post a compensating movement instead.');
    }
}

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

    /**
     * The types the stock_movements check constraint accepts.
     *
     * Duplicated from the migration on purpose. Letting an unknown type reach
     * Postgres turns a client's typo into a check violation, which surfaces to
     * the till as the generic "could not be applied" and retries for ever — the
     * cashier is told nothing and the adjustment never lands. Named here, the
     * same mistake comes back as a sentence saying which types exist.
     */
    private const TYPES = [
        'STOCK_IN', 'STOCK_OUT', 'SALE', 'RETURN', 'ADJUSTMENT',
        'DAMAGE', 'EXPIRED', 'AUDIT', 'TRANSFER_IN', 'TRANSFER_OUT',
    ];

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

        $type = $payload['type'] ?? 'ADJUSTMENT';
        if (! in_array($type, self::TYPES, true)) {
            return UpsertOutcome::conflict(
                sprintf('Unknown stock movement type [%s].', $type),
                ['allowed' => self::TYPES],
            );
        }

        $movement = $this->inventory->recordMovement(
            movementId: $recordId,
            product: $product,
            type: $type,
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

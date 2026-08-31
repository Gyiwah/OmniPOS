<?php

namespace App\Services;

use App\Models\Device;
use App\Models\Product;
use App\Models\StockMovement;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * The only sanctioned way to change stock.
 *
 * Inventory is a ledger, not a number. Consider two tills, both offline, both
 * showing 20 units:
 *
 *     Till A sells 5   ->  pushes movement -5
 *     Till B sells 8   ->  pushes movement -8
 *     server           ->  20 - 5 - 8 = 7
 *
 * Had the clients synced an absolute stock value instead, A would push 15, B
 * would push 12, and whichever arrived last would win — one sale silently erased
 * from inventory. Every stock change therefore goes through recordMovement(),
 * which appends to the ledger and derives products.stock from it.
 *
 * products.stock is a cache. It is never the input to a calculation, only ever an
 * output of one.
 */
class InventoryService
{
    /**
     * Append a movement and refresh the cached quantity.
     *
     * Idempotent on $movementId: replaying a sync push that already landed
     * returns the existing movement rather than double-counting it.
     */
    public function recordMovement(
        string $movementId,
        Product $product,
        string $type,
        float $quantity,
        string $reason,
        ?User $user = null,
        ?Device $device = null,
        ?string $sourceType = null,
        ?string $sourceId = null,
        ?string $batchId = null,
        ?string $notes = null,
        ?string $clientCreatedAt = null,
    ): StockMovement {
        return DB::transaction(function () use (
            $movementId, $product, $type, $quantity, $reason, $user, $device,
            $sourceType, $sourceId, $batchId, $notes, $clientCreatedAt
        ) {
            $existing = StockMovement::find($movementId);
            if ($existing) {
                return $existing;
            }

            // Lock the product row so two concurrent pushes cannot both read the
            // same "before" value and write conflicting "after" values.
            $locked = Product::whereKey($product->id)->lockForUpdate()->firstOrFail();

            $before = (float) $locked->stock;
            $after = $before + $quantity;

            $movement = StockMovement::create([
                'id' => $movementId,
                'store_id' => $locked->store_id,
                'product_id' => $locked->id,
                'batch_id' => $batchId,
                'user_id' => $user?->id,
                'device_id' => $device?->id,
                'type' => $type,
                'quantity' => $quantity,
                'quantity_before' => $before,
                'quantity_after' => $after,
                'reason' => $reason,
                'notes' => $notes,
                'source_type' => $sourceType,
                'source_id' => $sourceId,
                'client_created_at' => $clientCreatedAt,
            ]);

            // Derived from the ledger, not from the client's arithmetic.
            $locked->forceFill(['stock' => (int) round($this->ledgerBalance($locked->id))])->save();

            return $movement;
        });
    }

    /**
     * Post the movement that accounts for a product's starting quantity.
     *
     * Without this the ledger is incomplete: a product created with 20 units has
     * no movement explaining where those 20 came from, so the first sale would
     * recompute stock as (0 - 3) = -3 instead of 17. Every unit must enter
     * through a movement, including the very first ones.
     *
     * Called automatically from Product::created (see the model), which covers
     * seeding, admin creation and the Supabase data import alike.
     */
    public function recordOpeningBalance(Product $product): ?StockMovement
    {
        $opening = (float) $product->stock;

        if ($opening === 0.0) {
            return null;
        }

        return $this->recordMovement(
            movementId: (string) \Illuminate\Support\Str::uuid7(),
            product: $product,
            type: 'STOCK_IN',
            quantity: $opening,
            reason: 'Opening balance',
            sourceType: 'product',
            sourceId: $product->id,
        );
    }

    /**
     * Authoritative quantity: the sum of every movement ever recorded.
     *
     * Deliberately not memoised. If this and products.stock ever disagree, this
     * one is right.
     */
    public function ledgerBalance(string $productId): float
    {
        return (float) StockMovement::where('product_id', $productId)->sum('quantity');
    }

    /**
     * Rebuild the cached stock column for a store from its ledger.
     *
     * Run after a bulk data migration, or whenever an oversell investigation
     * suggests the cache has drifted.
     */
    public function reconcileStore(string $storeId): int
    {
        $updated = 0;

        Product::forStore($storeId)->chunkById(200, function ($products) use (&$updated) {
            foreach ($products as $product) {
                $balance = (int) round($this->ledgerBalance($product->id));
                if ((int) $product->stock !== $balance) {
                    $product->forceFill(['stock' => $balance])->save();
                    $updated++;
                }
            }
        });

        return $updated;
    }

    /**
     * Products whose ledger has gone negative — someone sold stock that was not
     * there, almost always because two offline tills sold the same last unit.
     *
     * This is surfaced for a human to reconcile rather than prevented, because
     * refusing the second sync push would mean discarding a sale that has already
     * happened and been receipted.
     *
     * @return \Illuminate\Support\Collection<int, Product>
     */
    public function oversoldProducts(string $storeId)
    {
        return Product::forStore($storeId)->where('stock', '<', 0)->get();
    }
}

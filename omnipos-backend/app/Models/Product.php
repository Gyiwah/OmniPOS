<?php

namespace App\Models;

use App\Models\Concerns\BelongsToStore;
use App\Models\Concerns\HasClientMintedUuid;
use App\Services\InventoryService;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Ported from Supabase public.products.
 *
 * `stock` is a cached aggregate of the stock_movements ledger, not the source of
 * truth. Write to it only through InventoryService so the ledger and the cache
 * cannot diverge.
 */
class Product extends Model
{
    use BelongsToStore;
    use HasClientMintedUuid;
    use SoftDeletes;

    protected $fillable = [
        'store_id',
        'category_id',
        'name',
        'sku',
        'barcode',
        'price',
        'cost_price',
        'stock',
        'reorder_level',
        'image_url',
        'tags',
        'expiry_date',
        'is_active',
    ];

    protected function casts(): array
    {
        return [
            'price' => 'decimal:2',
            'cost_price' => 'decimal:2',
            'stock' => 'integer',
            'reorder_level' => 'integer',
            'tags' => 'array',
            'expiry_date' => 'date',
            'is_active' => 'boolean',
        ];
    }

    /**
     * Keep the ledger complete from the moment a product exists.
     *
     * A product created with a starting quantity needs a movement accounting for
     * it, or that stock is invisible to the ledger and the first sale recomputes
     * the cached column from an incomplete history: 20 units, sell 3, and stock
     * settles at -3 instead of 17.
     *
     * Sync-created products arrive with no stock — ProductHandler ignores any
     * client-supplied quantity, because quantities move only through movements —
     * so this fires for seeding, admin creation and the Supabase data import,
     * not on the sync path.
     */
    protected static function booted(): void
    {
        static::created(function (self $product) {
            if ((int) $product->stock !== 0) {
                app(InventoryService::class)->recordOpeningBalance($product);
            }
        });
    }

    public function category(): BelongsTo
    {
        return $this->belongsTo(Category::class);
    }

    public function batches(): HasMany
    {
        return $this->hasMany(ProductBatch::class);
    }

    public function movements(): HasMany
    {
        return $this->hasMany(StockMovement::class);
    }

    public function priceHistory(): HasMany
    {
        return $this->hasMany(PriceHistory::class);
    }

    /** Products at or below their reorder threshold. */
    public function scopeLowStock($query)
    {
        return $query->whereColumn('stock', '<=', 'reorder_level');
    }
}

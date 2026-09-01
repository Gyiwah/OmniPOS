<?php

namespace App\Models;

use App\Models\Concerns\BelongsToStore;
use App\Models\Concerns\HasClientMintedUuid;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/** Ported from Supabase public.product_batches. */
class ProductBatch extends Model
{
    use BelongsToStore;
    use HasClientMintedUuid;
    use SoftDeletes;

    /**
     * `id` is fillable because clients mint it.
     *
     * ProductBatchHandler reaches this through firstOrNew(['id' => ...]).
     * Without it that throws, and creating a record fails while updating an
     * existing one succeeds — a gap no test that only edits existing rows can
     * find. See ClientMintedIdTest, which now pins this for every such model.
     */
    protected $fillable = [
        'id',
        'store_id',
        'product_id',
        'batch_number',
        'quantity',
        'cost_price',
        'expiry_date',
    ];

    protected function casts(): array
    {
        return [
            'quantity' => 'decimal:2',
            'cost_price' => 'decimal:2',
            'expiry_date' => 'date',
        ];
    }

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }
}

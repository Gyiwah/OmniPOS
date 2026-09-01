<?php

namespace App\Models;

use App\Models\Concerns\BelongsToStore;
use App\Models\Concerns\HasClientMintedUuid;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** Ported from Supabase public.price_history. Append-only. */
class PriceHistory extends Model
{
    use BelongsToStore;
    use HasClientMintedUuid;

    protected $table = 'price_history';

    protected $fillable = [
        'id',
        'store_id',
        'product_id',
        'user_id',
        'old_sell_price',
        'new_sell_price',
        'old_cost_price',
        'new_cost_price',
        'reason',
        'client_created_at',
    ];

    protected function casts(): array
    {
        return [
            'old_sell_price' => 'decimal:2',
            'new_sell_price' => 'decimal:2',
            'old_cost_price' => 'decimal:2',
            'new_cost_price' => 'decimal:2',
            'client_created_at' => 'datetime',
        ];
    }

    /**
     * Who changed it. The most useful column in this table: a price that moved
     * is only actionable once you know who moved it.
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }
}

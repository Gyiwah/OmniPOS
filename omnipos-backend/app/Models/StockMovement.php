<?php

namespace App\Models;

use App\Models\Concerns\BelongsToStore;
use App\Models\Concerns\HasClientMintedUuid;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * The authoritative inventory ledger. Append-only: never update or delete a
 * movement, post a compensating one instead.
 */
class StockMovement extends Model
{
    use BelongsToStore;
    use HasClientMintedUuid;

    protected $fillable = [
        'id',
        'store_id',
        'product_id',
        'batch_id',
        'user_id',
        'device_id',
        'type',
        'quantity',
        'quantity_before',
        'quantity_after',
        'reason',
        'notes',
        'source_type',
        'source_id',
        'client_created_at',
    ];

    protected function casts(): array
    {
        return [
            'quantity' => 'decimal:2',
            'quantity_before' => 'decimal:2',
            'quantity_after' => 'decimal:2',
            'client_created_at' => 'datetime',
        ];
    }

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }

    public function batch(): BelongsTo
    {
        return $this->belongsTo(ProductBatch::class, 'batch_id');
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}

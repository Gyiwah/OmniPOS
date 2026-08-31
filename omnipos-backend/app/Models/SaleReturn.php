<?php

namespace App\Models;

use App\Models\Concerns\BelongsToStore;
use App\Models\Concerns\HasClientMintedUuid;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Maps to the `returns` table.
 *
 * Named SaleReturn because `Return` is a reserved word in PHP and cannot be a
 * class name.
 */
class SaleReturn extends Model
{
    use BelongsToStore;
    use HasClientMintedUuid;
    use SoftDeletes;

    protected $table = 'returns';

    protected $fillable = [
        'id',
        'store_id',
        'order_id',
        'processed_by_user_id',
        'register_shift_id',
        'device_id',
        'reason',
        'amount',
        'refund_method',
        'client_created_at',
    ];

    protected function casts(): array
    {
        return [
            'amount' => 'decimal:2',
            'client_created_at' => 'datetime',
        ];
    }

    public function items(): HasMany
    {
        return $this->hasMany(ReturnItem::class, 'return_id');
    }

    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class);
    }

    public function processedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'processed_by_user_id');
    }
}

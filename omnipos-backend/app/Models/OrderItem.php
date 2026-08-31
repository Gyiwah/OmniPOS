<?php

namespace App\Models;

use App\Models\Concerns\BelongsToStore;
use App\Models\Concerns\HasClientMintedUuid;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Line items snapshot product name, sku and price at time of sale so a reprinted
 * receipt matches the one the customer was handed.
 */
class OrderItem extends Model
{
    use BelongsToStore;
    use HasClientMintedUuid;

    protected $fillable = [
        'id',
        'order_id',
        'store_id',
        'product_id',
        'product_name',
        'sku',
        'barcode',
        'unit_price',
        'quantity',
        'line_total',
        'unit_cost',
    ];

    protected function casts(): array
    {
        return [
            'unit_price' => 'decimal:2',
            'line_total' => 'decimal:2',
            'unit_cost' => 'decimal:2',
            'quantity' => 'integer',
        ];
    }

    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class);
    }

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }

    public function returnItems(): HasMany
    {
        return $this->hasMany(ReturnItem::class);
    }

    /**
     * Units already returned against this line. The POS subtracts this from
     * quantity to decide how many remain eligible, preventing a customer
     * returning more than they bought across several visits.
     */
    public function returnedQuantity(): int
    {
        return (int) $this->returnItems()->sum('quantity');
    }
}

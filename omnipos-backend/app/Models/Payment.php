<?php

namespace App\Models;

use App\Models\Concerns\BelongsToStore;
use App\Models\Concerns\HasClientMintedUuid;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One tender. An order paid part cash, part card has two of these.
 *
 * Also used for settlements against a customer's outstanding balance, in which
 * case order_id may be null and customer_id carries the relationship.
 */
class Payment extends Model
{
    use BelongsToStore;
    use HasClientMintedUuid;

    /**
     * 'other' exists for imported Supabase orders whose payment_method was
     * 'split': money was received but the tender breakdown was never recorded.
     * It is deliberately excluded from the cash total used to reconcile a drawer.
     */
    public const METHODS = ['cash', 'card', 'transfer', 'mobile_money', 'store_credit', 'loyalty', 'other'];

    protected $fillable = [
        'id',
        'store_id',
        'order_id',
        'customer_id',
        'register_shift_id',
        'received_by_user_id',
        'device_id',
        'method',
        'amount',
        'reference',
        'notes',
        'client_created_at',
    ];

    protected function casts(): array
    {
        return [
            'amount' => 'decimal:2',
            'client_created_at' => 'datetime',
        ];
    }

    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class);
    }

    public function customer(): BelongsTo
    {
        return $this->belongsTo(Customer::class);
    }

    public function registerShift(): BelongsTo
    {
        return $this->belongsTo(RegisterShift::class);
    }

    public function scopeCash($query)
    {
        return $query->where('method', 'cash');
    }
}

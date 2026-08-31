<?php

namespace App\Models;

use App\Models\Concerns\BelongsToStore;
use App\Models\Concerns\HasClientMintedUuid;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Ported from Supabase public.orders.
 *
 * Report on client_created_at, not created_at. An offline sale reaches the server
 * whenever the terminal next reconnects, which may be the following day; grouping
 * by created_at would move that day's takings into the wrong day.
 */
class Order extends Model
{
    use BelongsToStore;
    use HasClientMintedUuid;
    use SoftDeletes;

    protected $fillable = [
        'id',
        'store_id',
        'cashier_user_id',
        'customer_id',
        'register_shift_id',
        'device_id',
        'order_number',
        'status',
        'subtotal',
        'tax',
        'discount',
        'total',
        'tax_rate',
        'vat_rate',
        'service_rate',
        'discount_mode',
        'discount_value',
        'amount_paid',
        'change_due',
        'payment_method',
        'customer_name',
        'customer_phone',
        'shipping_address',
        'client_created_at',
    ];

    protected function casts(): array
    {
        return [
            'subtotal' => 'decimal:2',
            'tax' => 'decimal:2',
            'discount' => 'decimal:2',
            'total' => 'decimal:2',
            'tax_rate' => 'decimal:2',
            'vat_rate' => 'decimal:2',
            'service_rate' => 'decimal:2',
            'discount_value' => 'decimal:2',
            'amount_paid' => 'decimal:2',
            'change_due' => 'decimal:2',
            'client_created_at' => 'datetime',
            'version' => 'integer',
        ];
    }

    public function items(): HasMany
    {
        return $this->hasMany(OrderItem::class);
    }

    public function payments(): HasMany
    {
        return $this->hasMany(Payment::class);
    }

    public function returns(): HasMany
    {
        return $this->hasMany(SaleReturn::class);
    }

    public function customer(): BelongsTo
    {
        return $this->belongsTo(Customer::class);
    }

    public function cashier(): BelongsTo
    {
        return $this->belongsTo(User::class, 'cashier_user_id');
    }

    public function registerShift(): BelongsTo
    {
        return $this->belongsTo(RegisterShift::class);
    }

    public function device(): BelongsTo
    {
        return $this->belongsTo(Device::class);
    }

    /** Unpaid remainder on a credit sale. */
    public function outstanding(): string
    {
        return bcsub((string) $this->total, (string) $this->amount_paid, 2);
    }

    public function scopeCompleted($query)
    {
        return $query->where('status', 'completed');
    }
}

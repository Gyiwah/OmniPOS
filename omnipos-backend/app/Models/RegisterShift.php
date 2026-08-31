<?php

namespace App\Models;

use App\Models\Concerns\BelongsToStore;
use App\Models\Concerns\HasClientMintedUuid;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Cash drawer session. New server-side table — this exists only in the mobile
 * WatermelonDB schema today.
 */
class RegisterShift extends Model
{
    use BelongsToStore;
    use HasClientMintedUuid;

    protected $fillable = [
        'id',
        'store_id',
        'cashier_user_id',
        'device_id',
        'opened_at',
        'closed_at',
        'opening_float',
        'cash_sales',
        'cash_in',
        'cash_out',
        'expected_cash',
        'actual_cash',
        'discrepancy',
        'status',
        'notes',
        'movements_json',
    ];

    protected function casts(): array
    {
        return [
            'opened_at' => 'datetime',
            'closed_at' => 'datetime',
            'opening_float' => 'decimal:2',
            'cash_sales' => 'decimal:2',
            'cash_in' => 'decimal:2',
            'cash_out' => 'decimal:2',
            'expected_cash' => 'decimal:2',
            'actual_cash' => 'decimal:2',
            'discrepancy' => 'decimal:2',
            'movements_json' => 'array',
        ];
    }

    public function cashier(): BelongsTo
    {
        return $this->belongsTo(User::class, 'cashier_user_id');
    }

    public function orders(): HasMany
    {
        return $this->hasMany(Order::class);
    }

    public function payments(): HasMany
    {
        return $this->hasMany(Payment::class);
    }

    /**
     * What the drawer should hold: float, plus cash taken, plus paid-ins, less
     * paid-outs. Computed from the payments ledger rather than from the client's
     * cash_sales figure, so a device that synced late cannot understate the till.
     */
    public function computeExpectedCash(): string
    {
        $cashTaken = (string) $this->payments()->cash()->sum('amount');

        $refunded = (string) SaleReturn::query()
            ->where('register_shift_id', $this->id)
            ->where('refund_method', 'cash')
            ->sum('amount');

        $expected = bcadd((string) $this->opening_float, $cashTaken, 2);
        $expected = bcadd($expected, (string) $this->cash_in, 2);
        $expected = bcsub($expected, (string) $this->cash_out, 2);

        return bcsub($expected, $refunded, 2);
    }

    public function scopeOpen($query)
    {
        return $query->where('status', 'open');
    }
}

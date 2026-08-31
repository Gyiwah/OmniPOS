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
     * What the drawer should hold: float, plus net cash movement, plus paid-ins,
     * less paid-outs.
     *
     * Derived from the payments ledger rather than the client's cash_sales
     * figure, so a device that synced late cannot understate the till.
     *
     * Refunds are NOT subtracted separately here. They are negative rows in the
     * same ledger, so summing cash payments already nets them out; subtracting
     * them again would remove every refund from the drawer twice and make an
     * honest till look short by exactly the day's refunds.
     */
    public function computeExpectedCash(): string
    {
        $netCash = (string) $this->payments()->cash()->sum('amount');

        $expected = bcadd((string) $this->opening_float, $netCash, 2);
        $expected = bcadd($expected, (string) $this->cash_in, 2);

        return bcsub($expected, (string) $this->cash_out, 2);
    }

    public function scopeOpen($query)
    {
        return $query->where('status', 'open');
    }
}

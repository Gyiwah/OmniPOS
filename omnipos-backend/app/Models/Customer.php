<?php

namespace App\Models;

use App\Models\Concerns\BelongsToStore;
use App\Models\Concerns\HasClientMintedUuid;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Ported from Supabase public.customers.
 *
 * total_spend and outstanding_balance are running totals the server recomputes
 * from orders and payments. Never trust a client-supplied value for these: two
 * offline devices settling the same debt would otherwise each write their own
 * idea of the remaining balance.
 */
class Customer extends Model
{
    use BelongsToStore;
    use HasClientMintedUuid;
    use SoftDeletes;

    /**
     * `id` is fillable because clients mint it.
     *
     * The sync handlers reach this model through firstOrNew(['id' => ...]),
     * which mass-assigns the key when the record is new. Without it here that
     * throws, and creating a product or customer from a till fails while
     * updating an existing one succeeds — the kind of gap a test that only
     * edits existing rows will never find.
     */
    protected $fillable = [
        'id',
        'store_id',
        'name',
        'phone',
        'email',
        'total_spend',
        'outstanding_balance',
        'notes',
    ];

    protected function casts(): array
    {
        return [
            'total_spend' => 'decimal:2',
            'outstanding_balance' => 'decimal:2',
        ];
    }

    public function orders(): HasMany
    {
        return $this->hasMany(Order::class);
    }

    public function payments(): HasMany
    {
        return $this->hasMany(Payment::class);
    }
}

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

    /**
     * What a client may send, and what it means here.
     *
     * The mobile till's payment picker says "MoMo" and sends 'momo', which is
     * what the method is called everywhere it is used. The database check
     * constraint knows only 'mobile_money', so every mobile money sale rung up
     * on a phone was refused by the database on push — in the market where
     * mobile money is the common way to pay. Vocabulary drift between a client
     * and a schema is not a reason to lose a sale.
     *
     * Aliases are lowercased on both sides before lookup.
     */
    public const METHOD_ALIASES = [
        'momo' => 'mobile_money',
        'mobile money' => 'mobile_money',
        'mobilemoney' => 'mobile_money',
        'mtn momo' => 'mobile_money',
        'bank_transfer' => 'transfer',
        'bank transfer' => 'transfer',
        'credit' => 'store_credit',
        'account' => 'store_credit',
        'cheque' => 'other',
        'check' => 'other',
    ];

    /**
     * A method string as this schema spells it, or null if it means nothing here.
     *
     * Null rather than a fallback so each caller decides what an unrecognised
     * method costs. Booking a sale, it costs 'other' — the money arrived, and
     * refusing the whole order over a label would lose a sale that happened.
     * Recording a settlement, it is a conflict the cashier can correct.
     */
    public static function canonicalMethod(?string $method): ?string
    {
        $key = strtolower(trim((string) $method));

        if ($key === '') {
            return null;
        }

        $key = self::METHOD_ALIASES[$key] ?? $key;

        return in_array($key, self::METHODS, true) ? $key : null;
    }

    /** Every string a client may send, for validation and for the migration audit. */
    public static function acceptedMethodInputs(): array
    {
        return array_values(array_unique(array_merge(self::METHODS, array_keys(self::METHOD_ALIASES))));
    }

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

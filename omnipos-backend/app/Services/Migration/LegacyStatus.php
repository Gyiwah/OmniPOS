<?php

namespace App\Services\Migration;

/**
 * How a legacy order status becomes one of the four this schema allows.
 *
 * Shared by the importer and the pre-flight audit deliberately. They were
 * separate, and the audit reported "each will be mapped" for a status the
 * importer passed through untouched — so a run that had been declared safe died
 * on a check constraint part way through the orders step. A promise about what
 * will happen has to be made by the thing that does it.
 *
 * The mapping decides whether a sale counts towards revenue, which is why an
 * unrecognised status is a blocking finding rather than a default. Guessing
 * `completed` would invent takings; guessing `draft` would erase them.
 */
final class LegacyStatus
{
    /** The only values orders_status_check accepts. */
    public const TARGET = ['draft', 'completed', 'voided', 'refunded'];

    /**
     * Legacy value (lowercased) => target value.
     *
     * `part_paid` becomes `completed` because that is what it is: the goods left
     * the shop and the unpaid remainder is the customer's balance, which this
     * schema carries on the order as amount_paid < total rather than as a status.
     */
    private const MAP = [
        'draft' => 'draft',
        'pending' => 'draft',
        'open' => 'draft',

        'completed' => 'completed',
        'complete' => 'completed',
        'paid' => 'completed',
        'part_paid' => 'completed',
        'partially_paid' => 'completed',
        'partial' => 'completed',

        'voided' => 'voided',
        'void' => 'voided',
        'cancelled' => 'voided',
        'canceled' => 'voided',

        'refunded' => 'refunded',
        'returned' => 'refunded',
    ];

    public static function map(?string $status): ?string
    {
        if ($status === null || trim($status) === '') {
            // No status at all is the ordinary shape of an old completed sale.
            return 'completed';
        }

        return self::MAP[strtolower(trim($status))] ?? null;
    }

    /** True when this status has a defined meaning in the target. */
    public static function known(?string $status): bool
    {
        return self::map($status) !== null;
    }

    /** Legacy values that map to something other than themselves, for reporting. */
    public static function changes(?string $status): bool
    {
        $mapped = self::map($status);

        return $mapped !== null && $mapped !== strtolower(trim((string) $status));
    }
}

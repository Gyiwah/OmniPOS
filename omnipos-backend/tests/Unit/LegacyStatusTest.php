<?php

namespace Tests\Unit;

use App\Services\Migration\LegacyStatus;
use PHPUnit\Framework\TestCase;

/**
 * The legacy order status mapping.
 *
 * This exists as its own class because the importer and the pre-flight audit
 * both need it and once disagreed: the audit reported "each will be mapped" for
 * a status the importer passed straight through, so a run the audit had declared
 * safe died on a check constraint part way through the orders step. Found in
 * rehearsal, not by the suite.
 */
class LegacyStatusTest extends TestCase
{
    /**
     * The goods left the shop; the unpaid remainder is the customer's balance,
     * which this schema carries as amount_paid < total rather than as a status.
     * Mapping it to draft instead would erase a real sale from the books.
     */
    public function test_a_part_paid_sale_is_a_completed_sale(): void
    {
        $this->assertSame('completed', LegacyStatus::map('part_paid'));
        $this->assertSame('completed', LegacyStatus::map('partially_paid'));
        $this->assertSame('completed', LegacyStatus::map('partial'));
    }

    public function test_cancelled_becomes_voided(): void
    {
        $this->assertSame('voided', LegacyStatus::map('cancelled'));
        $this->assertSame('voided', LegacyStatus::map('canceled'));
    }

    public function test_it_ignores_case_and_surrounding_space(): void
    {
        $this->assertSame('completed', LegacyStatus::map('  COMPLETED '));
    }

    /** An old sale with no status recorded is an ordinary completed sale. */
    public function test_a_missing_status_is_completed(): void
    {
        $this->assertSame('completed', LegacyStatus::map(null));
        $this->assertSame('completed', LegacyStatus::map('   '));
    }

    /**
     * The important one. Guessing `completed` would invent takings and guessing
     * `draft` would erase them, so an unknown status is a decision for a person
     * — surfaced by the pre-flight, refused by the importer.
     */
    public function test_an_unrecognised_status_is_not_guessed_at(): void
    {
        $this->assertNull(LegacyStatus::map('layaway'));
        $this->assertFalse(LegacyStatus::known('layaway'));
    }

    public function test_every_mapped_value_is_one_the_schema_accepts(): void
    {
        foreach (['draft', 'pending', 'completed', 'part_paid', 'voided', 'cancelled', 'refunded', 'returned'] as $legacy) {
            $this->assertContains(
                LegacyStatus::map($legacy),
                LegacyStatus::TARGET,
                "{$legacy} maps outside the values orders_status_check allows",
            );
        }
    }

    public function test_it_reports_which_statuses_change_meaning(): void
    {
        // Reported to the operator, because the mapping decides whether the sale
        // counts towards revenue.
        $this->assertTrue(LegacyStatus::changes('part_paid'));
        $this->assertTrue(LegacyStatus::changes('cancelled'));

        // These arrive unchanged and need no comment.
        $this->assertFalse(LegacyStatus::changes('completed'));
        $this->assertFalse(LegacyStatus::changes('draft'));
    }
}

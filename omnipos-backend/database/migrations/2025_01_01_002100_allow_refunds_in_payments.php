<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Lets a payment be negative, so a refund is a row in the same ledger.
 *
 * Money leaving the drawer has to be recorded where money entering it is
 * recorded, or a shift reconciles against sales alone and always appears over by
 * exactly the day's refunds. Two ledgers for the same drawer is the kind of
 * split that produces a discrepancy nobody can explain.
 *
 * Zero is still refused: a payment of nothing is a bug, not a transaction.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('alter table payments drop constraint if exists payments_amount_check');
        DB::statement('alter table payments add constraint payments_amount_check check (amount <> 0)');
    }

    public function down(): void
    {
        // Refund rows would violate the old constraint, so they are removed
        // first rather than leaving the migration unable to reverse.
        DB::statement('delete from payments where amount < 0');
        DB::statement('alter table payments drop constraint if exists payments_amount_check');
        DB::statement('alter table payments add constraint payments_amount_check check (amount > 0)');
    }
};

<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Adds 'other' to the allowed payment methods.
 *
 * Supabase recorded a single payment_method string per order, including the value
 * 'split' — which says money arrived by more than one tender but not which ones
 * or in what proportion. That detail is unrecoverable.
 *
 * Importing those as 'cash' would be a lie that corrupts drawer reconciliation:
 * a shift's expected cash is computed from cash payments, so misfiled card money
 * would make every affected till appear short. 'other' records the amount
 * honestly as "received, tender unknown" and keeps it out of the cash total.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('alter table payments drop constraint if exists payments_method_check');
        DB::statement(
            "alter table payments add constraint payments_method_check check (method in ('cash', 'card', 'transfer', 'mobile_money', 'store_credit', 'loyalty', 'other'))"
        );
    }

    public function down(): void
    {
        DB::statement('alter table payments drop constraint if exists payments_method_check');
        DB::statement(
            "alter table payments add constraint payments_method_check check (method in ('cash', 'card', 'transfer', 'mobile_money', 'store_credit', 'loyalty'))"
        );
    }
};

<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Ported from Supabase public.customers (migration 009).
 *
 * total_spend and outstanding_balance are denormalised running totals that the
 * mobile client both reads and writes. They are kept as-is for the port: the
 * client's credit-sale and settlement flows depend on them, and recomputing them
 * from orders would change behaviour mid-migration. Treat them as derived state
 * that the server recalculates on order/payment writes rather than trusting a
 * client-supplied value blindly.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('customers', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('store_id')->constrained('stores')->cascadeOnDelete();

            $table->string('name');
            $table->string('phone')->nullable();
            $table->string('email')->nullable();
            $table->decimal('total_spend', 14, 2)->default(0);
            $table->decimal('outstanding_balance', 14, 2)->default(0);
            $table->text('notes')->nullable();

            $table->timestampsTz();
            $table->softDeletesTz();

            $table->index('store_id');
            $table->index(['store_id', 'phone']);
            $table->index(['store_id', 'updated_at']);
        });

        DB::statement('alter table customers add constraint customers_total_spend_check check (total_spend >= 0)');
    }

    public function down(): void
    {
        Schema::dropIfExists('customers');
    }
};

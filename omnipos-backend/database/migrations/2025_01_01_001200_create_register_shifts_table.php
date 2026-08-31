<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * NEW SERVER-SIDE TABLE — no Supabase counterpart exists.
 *
 * register_shifts lives only in the mobile WatermelonDB schema (v6). The mobile
 * shift service already enqueues sync operations for it, but nothing on the
 * Supabase side ever consumed them, so they could never have succeeded. This
 * migration is therefore new build rather than a port, and there is no shift data
 * to migrate from Supabase.
 *
 * movements_json holds the cash in/out entries the client records during a shift.
 * It stays denormalised to match the client's existing shape for the port; split
 * it into a cash_movements table when the web register UI needs to query them.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('register_shifts', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('store_id')->constrained('stores')->cascadeOnDelete();
            $table->foreignUuid('cashier_user_id')->constrained('users')->restrictOnDelete();
            $table->foreignUuid('device_id')->nullable()->constrained('devices')->nullOnDelete();

            $table->timestampTz('opened_at');
            $table->timestampTz('closed_at')->nullable();

            $table->decimal('opening_float', 14, 2)->default(0);
            $table->decimal('cash_sales', 14, 2)->default(0);
            $table->decimal('cash_in', 14, 2)->default(0);
            $table->decimal('cash_out', 14, 2)->default(0);
            $table->decimal('expected_cash', 14, 2)->default(0);
            $table->decimal('actual_cash', 14, 2)->nullable();
            $table->decimal('discrepancy', 14, 2)->nullable();

            $table->string('status')->default('open');
            $table->text('notes')->nullable();
            $table->jsonb('movements_json')->default(DB::raw("'[]'::jsonb"));

            $table->timestampsTz();

            $table->index(['store_id', 'status']);
            $table->index(['store_id', 'opened_at']);
            $table->index('cashier_user_id');
        });

        DB::statement(
            "alter table register_shifts add constraint register_shifts_status_check check (status in ('open', 'closed'))"
        );

        // One open shift per cashier per store. A partial unique index expresses
        // this without blocking the many historical closed shifts they accumulate.
        DB::statement(
            "create unique index register_shifts_one_open_per_cashier on register_shifts (store_id, cashier_user_id) where status = 'open'"
        );
    }

    public function down(): void
    {
        Schema::dropIfExists('register_shifts');
    }
};

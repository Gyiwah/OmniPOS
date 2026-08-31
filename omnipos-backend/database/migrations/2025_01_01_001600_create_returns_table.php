<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Ported from Supabase public.returns.
 *
 * order_id is restrictOnDelete: a refund must always be traceable to the sale it
 * reverses, so the sale cannot be deleted out from under it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('returns', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('store_id')->constrained('stores')->cascadeOnDelete();
            $table->foreignUuid('order_id')->constrained('orders')->restrictOnDelete();
            $table->foreignUuid('processed_by_user_id')->constrained('users')->restrictOnDelete();
            $table->foreignUuid('register_shift_id')->nullable()->constrained('register_shifts')->nullOnDelete();
            $table->foreignUuid('device_id')->nullable()->constrained('devices')->nullOnDelete();

            $table->text('reason')->default('');
            $table->decimal('amount', 14, 2);
            $table->string('refund_method')->default('cash');

            $table->timestampTz('client_created_at')->nullable();
            $table->timestampsTz();
            $table->softDeletesTz();

            $table->index('store_id');
            $table->index('order_id');
            $table->index(['store_id', 'created_at']);
        });

        DB::statement('alter table returns add constraint returns_amount_check check (amount >= 0)');
    }

    public function down(): void
    {
        Schema::dropIfExists('returns');
    }
};

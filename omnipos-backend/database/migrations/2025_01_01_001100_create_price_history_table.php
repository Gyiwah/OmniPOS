<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Ported from Supabase public.price_history (migration 012). Append-only.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('price_history', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('store_id')->constrained('stores')->cascadeOnDelete();
            $table->foreignUuid('product_id')->constrained('products')->cascadeOnDelete();
            $table->foreignUuid('user_id')->nullable()->constrained('users')->nullOnDelete();

            $table->decimal('old_sell_price', 14, 2)->default(0);
            $table->decimal('new_sell_price', 14, 2)->default(0);
            $table->decimal('old_cost_price', 14, 2)->nullable();
            $table->decimal('new_cost_price', 14, 2)->nullable();
            $table->string('reason')->nullable();

            $table->timestampTz('client_created_at')->nullable();
            $table->timestampsTz();

            $table->index('store_id');
            $table->index('product_id');
            $table->index(['store_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('price_history');
    }
};

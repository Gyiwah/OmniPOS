<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Ported from Supabase public.product_batches (migration 012).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('product_batches', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('store_id')->constrained('stores')->cascadeOnDelete();
            $table->foreignUuid('product_id')->constrained('products')->cascadeOnDelete();

            $table->string('batch_number');
            $table->decimal('quantity', 14, 2)->default(0);
            $table->decimal('cost_price', 14, 2)->nullable();
            $table->date('expiry_date')->nullable();

            $table->timestampsTz();
            $table->softDeletesTz();

            $table->index('store_id');
            $table->index('product_id');
            $table->index(['store_id', 'expiry_date']);
            $table->unique(['store_id', 'product_id', 'batch_number']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('product_batches');
    }
};

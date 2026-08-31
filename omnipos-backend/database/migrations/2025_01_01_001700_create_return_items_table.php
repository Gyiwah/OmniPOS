<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Ported from Supabase public.return_items (migration 007).
 *
 * order_item_id is restrictOnDelete so the returned quantity per original line
 * stays computable. The mobile client relies on that sum to stop a customer
 * returning three of an item they bought two of — a bug already fixed once in
 * this codebase (commit f682418), so the constraint matters.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('return_items', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('return_id')->constrained('returns')->cascadeOnDelete();
            $table->foreignUuid('store_id')->constrained('stores')->cascadeOnDelete();
            $table->foreignUuid('order_item_id')->constrained('order_items')->restrictOnDelete();
            $table->foreignUuid('product_id')->nullable()->constrained('products')->nullOnDelete();

            $table->string('product_name');
            $table->decimal('unit_price', 14, 2);
            $table->integer('quantity');
            $table->decimal('line_total', 14, 2);
            $table->boolean('restock')->default(true);

            $table->timestampsTz();

            $table->index('return_id');
            $table->index('store_id');
            $table->index('order_item_id');
        });

        DB::statement('alter table return_items add constraint return_items_quantity_check check (quantity > 0)');
    }

    public function down(): void
    {
        Schema::dropIfExists('return_items');
    }
};

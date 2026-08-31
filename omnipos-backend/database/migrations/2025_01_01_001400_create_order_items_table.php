<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Ported from Supabase public.order_items (migration 005).
 *
 * product_name, sku, barcode and unit_price are snapshotted onto the line rather
 * than joined from products. A receipt must reprint years later exactly as it was
 * issued, even after the product is renamed, repriced or deleted — which is also
 * why product_id is nullOnDelete rather than cascade.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('order_items', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('order_id')->constrained('orders')->cascadeOnDelete();
            $table->foreignUuid('store_id')->constrained('stores')->cascadeOnDelete();
            $table->foreignUuid('product_id')->nullable()->constrained('products')->nullOnDelete();

            $table->string('product_name');
            $table->string('sku')->nullable();
            $table->string('barcode')->nullable();

            $table->decimal('unit_price', 14, 2);
            $table->integer('quantity');
            $table->decimal('line_total', 14, 2);

            // Unit cost at time of sale, so profit reports do not drift when the
            // product's cost price is later updated.
            $table->decimal('unit_cost', 14, 2)->nullable();

            $table->timestampsTz();

            $table->index('order_id');
            $table->index('store_id');
            $table->index('product_id');
        });

        DB::statement('alter table order_items add constraint order_items_quantity_check check (quantity > 0)');
        DB::statement('alter table order_items add constraint order_items_unit_price_check check (unit_price >= 0)');
    }

    public function down(): void
    {
        Schema::dropIfExists('order_items');
    }
};

<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Ported from Supabase public.products (000 + 009 + 012).
 *
 * On the `stock` column: it is a cached quantity, not the source of truth. The
 * ledger in stock_movements is authoritative, because two devices selling the
 * same product while offline must both have their decrements applied rather than
 * one overwriting the other. The server recomputes this column from the ledger
 * when movements are applied; it exists so that product listings do not have to
 * aggregate the ledger on every read.
 *
 * The Supabase schema had CHECK (stock >= 0). That constraint is deliberately
 * NOT carried over: an offline device can legitimately push a sale that drives
 * stock negative when another device sold the same unit first. Rejecting it at
 * the database level would fail the whole sync push and lose a real sale.
 * Negative stock is surfaced as an oversell to reconcile, not as a write error.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('products', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('store_id')->constrained('stores')->cascadeOnDelete();
            $table->foreignUuid('category_id')->nullable()->constrained('categories')->nullOnDelete();

            $table->string('name');
            $table->string('sku');
            $table->string('barcode')->nullable();

            $table->decimal('price', 14, 2);
            $table->decimal('cost_price', 14, 2)->nullable();

            $table->integer('stock')->default(0);
            $table->integer('reorder_level')->default(5);

            $table->string('image_url')->nullable();
            $table->jsonb('tags')->default(DB::raw("'[]'::jsonb"));
            $table->date('expiry_date')->nullable();
            $table->boolean('is_active')->default(true);

            $table->timestampsTz();
            $table->softDeletesTz();

            $table->unique(['store_id', 'sku']);
            $table->index('store_id');
            $table->index(['store_id', 'barcode']);
            $table->index(['store_id', 'updated_at']);
            $table->index(['store_id', 'is_active']);
        });

        DB::statement('alter table products add constraint products_price_check check (price >= 0)');
        DB::statement('alter table products add constraint products_cost_price_check check (cost_price is null or cost_price >= 0)');
        DB::statement('alter table products add constraint products_reorder_level_check check (reorder_level >= 0)');

        // Product search on the web POS: trigram index over name and SKU so that
        // partial matches stay fast on large catalogues.
        DB::statement('create extension if not exists pg_trgm');
        DB::statement('create index products_name_trgm_idx on products using gin (name gin_trgm_ops)');
        DB::statement('create index products_sku_trgm_idx on products using gin (sku gin_trgm_ops)');
    }

    public function down(): void
    {
        Schema::dropIfExists('products');
    }
};

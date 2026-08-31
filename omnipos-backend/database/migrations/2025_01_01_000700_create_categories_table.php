<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * New table with no Supabase counterpart.
 *
 * The mobile client currently groups products with a free-text tags array. That
 * works on a phone but not for the web POS, which needs a category rail to be
 * usable with a mouse at speed. Products keep their tags column during the port;
 * category_id is nullable so the two can coexist until the client migrates.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('categories', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('store_id')->constrained('stores')->cascadeOnDelete();
            $table->uuid('parent_id')->nullable();

            $table->string('name');
            $table->string('color', 16)->nullable();
            $table->integer('position')->default(0);

            $table->timestampsTz();
            $table->softDeletesTz();

            $table->unique(['store_id', 'name']);
            $table->index(['store_id', 'position']);
        });

        // Self-referencing key added post-create; see the stores migration.
        Schema::table('categories', function (Blueprint $table) {
            $table->foreign('parent_id')->references('id')->on('categories')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('categories');
    }
};

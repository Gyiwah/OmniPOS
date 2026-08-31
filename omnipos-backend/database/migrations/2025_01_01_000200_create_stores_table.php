<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Ported from Supabase public.stores.
 *
 * parent_store_id is retained from migration 011 and models the branch hierarchy:
 * a store with a parent is a branch of it. Explicit businesses/stores/branches
 * entities were considered and deferred — the mobile client currently treats a
 * "store" as the tenant boundary throughout, and splitting that concept is a
 * behavioural change to make deliberately, not as a side effect of the port.
 *
 * Percentage columns carried CHECK constraints in the Supabase schema. Laravel's
 * schema builder has no first-class check-constraint API, so they are added as
 * raw statements to keep the guarantee in the database rather than relying on
 * application validation alone.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('stores', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('parent_store_id')->nullable();
            $table->foreignUuid('owner_user_id')->constrained('users')->restrictOnDelete();

            $table->string('name');
            $table->string('email')->nullable();
            $table->string('logo_url')->nullable();

            $table->string('tax_profile')->default('standard');
            $table->string('currency', 8)->default('USD');
            $table->string('timezone')->default('UTC');
            $table->string('language')->default('English');
            $table->boolean('app_mode_dark')->default(false);

            $table->decimal('tax_rate', 6, 2)->default(0);
            $table->decimal('vat_rate', 6, 2)->default(0);
            $table->decimal('service_rate', 6, 2)->default(0);

            $table->timestampsTz();
            $table->softDeletesTz();

            $table->index('parent_store_id');
            $table->index('owner_user_id');
        });

        // The self-referencing branch key is added after the table exists.
        // Inside Schema::create, Laravel appends the fluent ->primary() command
        // AFTER the ->constrained() foreign key, so a self-reference would try to
        // point at a primary key that has not been created yet. References to
        // other tables are unaffected: their primary keys already exist.
        Schema::table('stores', function (Blueprint $table) {
            $table->foreign('parent_store_id')->references('id')->on('stores')->cascadeOnDelete();
        });

        foreach (['tax_rate', 'vat_rate', 'service_rate'] as $column) {
            DB::statement(
                "alter table stores add constraint stores_{$column}_range check ({$column} >= 0 and {$column} <= 100)"
            );
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('stores');
    }
};

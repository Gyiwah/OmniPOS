<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Ported from Supabase public.store_members.
 *
 * This table is the entire multi-tenancy boundary. Supabase enforced it with RLS
 * (is_store_member / has_store_role); Laravel enforces it in
 * App\Http\Middleware\EnsureStoreAccess plus the model policies. Every
 * store-scoped query must be constrained through a membership check — there is no
 * database-level backstop any more, which is precisely why the middleware is
 * mandatory on all store-scoped routes.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('store_members', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('store_id')->constrained('stores')->cascadeOnDelete();
            $table->foreignUuid('user_id')->constrained('users')->cascadeOnDelete();
            $table->string('role');
            $table->foreignUuid('invited_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();

            $table->unique(['store_id', 'user_id']);
            $table->index('user_id');
            $table->index(['store_id', 'role']);
        });

        DB::statement(
            "alter table store_members add constraint store_members_role_check check (role in ('admin', 'manager', 'cashier'))"
        );
    }

    public function down(): void
    {
        Schema::dropIfExists('store_members');
    }
};

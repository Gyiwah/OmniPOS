<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Ported from Supabase public.store_invites (migration 008).
 *
 * The accept_pending_store_invites() plpgsql function becomes
 * App\Services\StoreInviteService::acceptPendingFor(), and the
 * invite-store-member Edge Function becomes an ordinary controller action.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('store_invites', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('store_id')->constrained('stores')->cascadeOnDelete();
            $table->string('email');
            $table->string('role');
            $table->string('status')->default('pending');
            $table->foreignUuid('invited_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('accepted_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('token', 64)->unique();
            $table->timestampTz('expires_at');
            $table->timestampsTz();

            $table->unique(['store_id', 'email']);
            $table->index(['store_id', 'status']);
        });

        // Case-insensitive lookup by email, matching the Supabase index on lower(email).
        DB::statement('create index store_invites_email_status_idx on store_invites (lower(email), status)');
        DB::statement(
            "alter table store_invites add constraint store_invites_role_check check (role in ('admin', 'manager', 'cashier'))"
        );
        DB::statement(
            "alter table store_invites add constraint store_invites_status_check check (status in ('pending', 'accepted', 'revoked', 'expired'))"
        );
    }

    public function down(): void
    {
        Schema::dropIfExists('store_invites');
    }
};

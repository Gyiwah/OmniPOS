<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Replaces Supabase auth.users + public.profiles.
 *
 * The Supabase schema needed a separate profiles table only because auth.users is
 * owned by GoTrue and cannot be extended. Laravel owns this table, so the profile
 * columns (name, avatar, super-admin flag) live here directly instead of in a
 * second table joined 1:1 on every request.
 *
 * id is a UUID with no database default: clients mint their own identifiers and
 * the server accepts them verbatim. See the mobile repo's src/core/README.md.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('users', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('name');
            $table->string('email')->unique();
            $table->timestampTz('email_verified_at')->nullable();

            // Nullable: users provisioned by invite have no password until they
            // set one, mirroring how Supabase invite/magic-link accounts behaved.
            $table->string('password')->nullable();
            $table->string('avatar_url')->nullable();

            // Platform operator, not a store role. Store-level roles live in
            // store_members because one user may hold different roles per store.
            $table->boolean('is_super_admin')->default(false);

            $table->rememberToken();
            $table->timestampsTz();
            $table->softDeletesTz();

            $table->index('is_super_admin');
        });

        Schema::create('password_reset_tokens', function (Blueprint $table) {
            $table->string('email')->primary();
            $table->string('token');
            $table->timestampTz('created_at')->nullable();
        });

        Schema::create('sessions', function (Blueprint $table) {
            $table->string('id')->primary();
            $table->uuid('user_id')->nullable()->index();
            $table->string('ip_address', 45)->nullable();
            $table->text('user_agent')->nullable();
            $table->longText('payload');
            $table->integer('last_activity')->index();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('sessions');
        Schema::dropIfExists('password_reset_tokens');
        Schema::dropIfExists('users');
    }
};

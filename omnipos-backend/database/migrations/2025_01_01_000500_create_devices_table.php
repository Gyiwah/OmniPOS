<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * New table with no Supabase counterpart.
 *
 * Offline-first sync needs a stable identity for each installation so that
 * operations can be attributed, replays recognised, and a client's pull cursor
 * remembered server-side. The mobile app registers once on first sync; the web
 * client registers per browser profile.
 *
 * terminal_label is the human-facing name ("Front till 2") that appears on
 * Z-reports and audit entries.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('devices', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('store_id')->constrained('stores')->cascadeOnDelete();
            $table->foreignUuid('user_id')->nullable()->constrained('users')->nullOnDelete();

            $table->string('platform');
            $table->string('terminal_label')->nullable();
            $table->string('app_version')->nullable();

            // Highest sync_changes.sequence this device has confirmed applying.
            // Advisory only: the client sends its own cursor on pull, and this
            // column exists for support and monitoring rather than correctness.
            $table->unsignedBigInteger('last_pull_sequence')->default(0);
            $table->timestampTz('last_seen_at')->nullable();

            $table->timestampsTz();

            $table->index(['store_id', 'last_seen_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('devices');
    }
};

<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Synchronisation infrastructure. Replaces Supabase Realtime and the (never
 * populated) public.sync_log table.
 *
 * Three tables, three jobs:
 *
 *  sync_operations — idempotency ledger for PUSH. A client that loses the network
 *      after the server committed cannot know whether its write landed, so it
 *      retries. operation_id is unique, so the retry is recognised and the stored
 *      result is replayed instead of the order being created twice.
 *
 *  sync_changes  — the changefeed clients PULL. Monotonic bigint sequence rather
 *      than the updated_at timestamps the mobile client uses against Supabase
 *      today: timestamps are unsafe across devices with skewed clocks, and two
 *      rows written in the same millisecond can straddle a cursor boundary and
 *      one gets skipped for ever.
 *
 *  sync_conflicts — operations the server could not apply as sent (order number
 *      already taken, stale version, referenced record missing). Recorded rather
 *      than discarded so a human can reconcile; losing a sale silently is worse
 *      than surfacing a conflict.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('sync_operations', function (Blueprint $table) {
            $table->bigIncrements('id');

            // Client-generated, globally unique. This is the idempotency key.
            $table->uuid('operation_id')->unique();

            $table->foreignUuid('store_id')->constrained('stores')->cascadeOnDelete();
            $table->foreignUuid('device_id')->nullable()->constrained('devices')->nullOnDelete();
            $table->foreignUuid('user_id')->nullable()->constrained('users')->nullOnDelete();

            $table->string('entity');
            $table->uuid('record_id');
            $table->string('action');
            $table->string('status')->default('applied');

            // Response returned for the original attempt, replayed verbatim on a
            // duplicate so the client sees identical results either way.
            $table->jsonb('result')->nullable();
            $table->text('error')->nullable();

            $table->timestampTz('client_created_at')->nullable();
            $table->timestampTz('processed_at')->nullable();
            $table->timestampsTz();

            $table->index(['store_id', 'entity']);
            $table->index(['device_id', 'created_at']);
            $table->index('record_id');
        });

        DB::statement(
            "alter table sync_operations add constraint sync_operations_action_check check (action in ('insert', 'upsert', 'update', 'delete'))"
        );
        DB::statement(
            "alter table sync_operations add constraint sync_operations_status_check check (status in ('applied', 'duplicate', 'conflict', 'failed'))"
        );

        Schema::create('sync_changes', function (Blueprint $table) {
            // The pull cursor. bigserial, so it only ever increases.
            $table->bigIncrements('sequence');

            $table->foreignUuid('store_id')->constrained('stores')->cascadeOnDelete();
            $table->string('entity');
            $table->uuid('record_id');
            $table->string('action');
            $table->jsonb('payload');

            // The device whose push produced this change. A client filters its own
            // changes out of its pull, since it already applied them locally.
            $table->foreignUuid('origin_device_id')->nullable()->constrained('devices')->nullOnDelete();

            $table->timestampTz('created_at')->useCurrent();

            $table->index(['store_id', 'sequence']);
            $table->index(['store_id', 'entity', 'sequence']);
        });

        DB::statement(
            "alter table sync_changes add constraint sync_changes_action_check check (action in ('upsert', 'delete'))"
        );

        Schema::create('sync_conflicts', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->uuid('operation_id')->nullable();
            $table->foreignUuid('store_id')->constrained('stores')->cascadeOnDelete();
            $table->foreignUuid('device_id')->nullable()->constrained('devices')->nullOnDelete();

            $table->string('entity');
            $table->uuid('record_id');
            $table->string('reason');
            $table->jsonb('client_payload')->nullable();
            $table->jsonb('server_state')->nullable();

            $table->string('resolution')->default('pending');
            $table->foreignUuid('resolved_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('resolved_at')->nullable();

            $table->timestampsTz();

            $table->index(['store_id', 'resolution']);
            $table->index('record_id');
        });

        DB::statement(
            "alter table sync_conflicts add constraint sync_conflicts_resolution_check check (resolution in ('pending', 'server_wins', 'client_wins', 'merged', 'ignored'))"
        );
    }

    public function down(): void
    {
        Schema::dropIfExists('sync_conflicts');
        Schema::dropIfExists('sync_changes');
        Schema::dropIfExists('sync_operations');
    }
};

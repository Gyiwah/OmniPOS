<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Audit trail (migration plan §43).
 *
 * A commercial POS needs to answer "who discounted this, who voided that, who was
 * at the till when the drawer came up short". Recorded for overrides, price
 * changes, stock adjustments, voids, refunds and role changes.
 *
 * Append-only: no updated_at, no soft deletes. An audit row that can be edited is
 * not an audit row.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('audit_logs', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->foreignUuid('store_id')->nullable()->constrained('stores')->nullOnDelete();
            $table->foreignUuid('user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('device_id')->nullable()->constrained('devices')->nullOnDelete();

            $table->string('action');
            $table->string('entity_type')->nullable();
            $table->uuid('entity_id')->nullable();

            $table->jsonb('before')->nullable();
            $table->jsonb('after')->nullable();

            // Who authorised an override, when it differs from who performed it.
            $table->foreignUuid('authorized_by_user_id')->nullable()->constrained('users')->nullOnDelete();

            $table->string('ip_address', 45)->nullable();
            $table->text('user_agent')->nullable();

            $table->timestampTz('created_at')->useCurrent();

            $table->index(['store_id', 'created_at']);
            $table->index(['entity_type', 'entity_id']);
            $table->index('user_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('audit_logs');
    }
};

<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Ported from Supabase public.stock_movements (migration 012), promoted from an
 * audit trail to the authoritative inventory ledger.
 *
 * This is the table that makes offline multi-device stock correct. Two terminals
 * that each sell from a stock of 20 while disconnected push two movement rows of
 * -5 and -8; the server applies both and products.stock settles at 7. Had stock
 * been synced as an absolute value, the second push would have overwritten the
 * first and one sale would have vanished from inventory.
 *
 * Consequences that follow from that, and must not be undone:
 *  - rows are append-only; corrections are new movements, never edits
 *  - quantity is signed (negative for outbound)
 *  - quantity_before/quantity_after record what THIS device believed at the time,
 *    so they are evidence for reconciliation, not a server-side invariant
 *  - a movement is idempotent on id, so a replayed sync push is a no-op
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('stock_movements', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('store_id')->constrained('stores')->cascadeOnDelete();
            $table->foreignUuid('product_id')->constrained('products')->cascadeOnDelete();
            $table->foreignUuid('batch_id')->nullable()->constrained('product_batches')->nullOnDelete();
            $table->foreignUuid('user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('device_id')->nullable()->constrained('devices')->nullOnDelete();

            $table->string('type');
            $table->decimal('quantity', 14, 2);
            $table->decimal('quantity_before', 14, 2)->default(0);
            $table->decimal('quantity_after', 14, 2)->default(0);

            $table->string('reason');
            $table->text('notes')->nullable();

            // What caused this movement (an order, a return, a stock take), so the
            // ledger can be traced back without a join table per source type.
            $table->string('source_type')->nullable();
            $table->uuid('source_id')->nullable();

            $table->timestampTz('client_created_at')->nullable();
            $table->timestampsTz();

            $table->index('store_id');
            $table->index('product_id');
            $table->index(['store_id', 'created_at']);
            $table->index(['source_type', 'source_id']);
        });

        DB::statement(
            "alter table stock_movements add constraint stock_movements_type_check check (type in ('STOCK_IN', 'STOCK_OUT', 'SALE', 'RETURN', 'ADJUSTMENT', 'DAMAGE', 'EXPIRED', 'AUDIT', 'TRANSFER_IN', 'TRANSFER_OUT'))"
        );
    }

    public function down(): void
    {
        Schema::dropIfExists('stock_movements');
    }
};

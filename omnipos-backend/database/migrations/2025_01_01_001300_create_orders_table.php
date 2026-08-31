<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Ported from Supabase public.orders, with the offline provenance columns from
 * the migration plan (§18) added.
 *
 * Provenance columns and why each earns its place:
 *  - device_id / register_shift_id: which terminal and which drawer took the
 *    money. Without these a Z-report cannot be reconciled against the till.
 *  - client_created_at: when the sale happened on the device. created_at is when
 *    the server first saw it, which for an offline sale can be hours later.
 *    Every sales report must group by client_created_at, or a day's takings
 *    shift into whichever day the terminal happened to reconnect.
 *  - version: incremented on each server-side write, for optimistic concurrency
 *    when two clients edit the same order.
 *
 * order_number is unique per store, as in Supabase. Clients generate it offline,
 * so collisions between terminals are possible; the sync layer surfaces a
 * conflict rather than silently renumbering a receipt the customer already holds.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('orders', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('store_id')->constrained('stores')->cascadeOnDelete();
            $table->foreignUuid('cashier_user_id')->constrained('users')->restrictOnDelete();
            $table->foreignUuid('customer_id')->nullable()->constrained('customers')->nullOnDelete();
            $table->foreignUuid('register_shift_id')->nullable()->constrained('register_shifts')->nullOnDelete();
            $table->foreignUuid('device_id')->nullable()->constrained('devices')->nullOnDelete();

            $table->string('order_number');
            $table->string('status')->default('completed');

            $table->decimal('subtotal', 14, 2)->default(0);
            $table->decimal('tax', 14, 2)->default(0);
            $table->decimal('discount', 14, 2)->default(0);
            $table->decimal('total', 14, 2)->default(0);

            $table->decimal('tax_rate', 6, 2)->default(0);
            $table->decimal('vat_rate', 6, 2)->default(0);
            $table->decimal('service_rate', 6, 2)->default(0);

            $table->string('discount_mode')->default('percentage');
            $table->decimal('discount_value', 14, 2)->default(0);

            $table->decimal('amount_paid', 14, 2)->default(0);
            $table->decimal('change_due', 14, 2)->default(0);

            // Retained for the port. With the payments table now holding the
            // authoritative tender breakdown, this is the summary label shown in
            // lists: 'split' when more than one payment row exists.
            $table->string('payment_method')->default('cash');

            // Denormalised walk-in details for orders with no customer record.
            $table->string('customer_name')->nullable();
            $table->string('customer_phone')->nullable();
            $table->text('shipping_address')->nullable();

            $table->timestampTz('client_created_at')->nullable();
            $table->unsignedInteger('version')->default(1);

            $table->timestampsTz();
            $table->softDeletesTz();

            $table->unique(['store_id', 'order_number']);
            $table->index('store_id');
            $table->index(['store_id', 'client_created_at']);
            $table->index(['store_id', 'status']);
            $table->index('customer_id');
            $table->index('register_shift_id');
        });

        DB::statement(
            "alter table orders add constraint orders_status_check check (status in ('draft', 'completed', 'voided', 'refunded'))"
        );
        DB::statement(
            "alter table orders add constraint orders_discount_mode_check check (discount_mode in ('percentage', 'amount'))"
        );
        DB::statement('alter table orders add constraint orders_total_check check (total >= 0)');
        DB::statement('alter table orders add constraint orders_amount_paid_check check (amount_paid >= 0)');
    }

    public function down(): void
    {
        Schema::dropIfExists('orders');
    }
};

<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * New table with no Supabase counterpart.
 *
 * Supabase stored a single payment_method string per order, which cannot express
 * "GHS 40 cash + GHS 60 card" — the split-tender case the mobile plan calls for
 * and that any real till needs. Each tender is now its own row.
 *
 * Payments are also how a credit sale is settled: an order can be created with
 * amount_paid below total, and later payment rows reduce the customer's
 * outstanding_balance. That is why a payment carries a customer_id of its own
 * rather than relying on the order's — a settlement may cover several orders.
 *
 * Cash payments carry register_shift_id so the drawer reconciles: expected_cash
 * on a shift is opening_float plus cash payments plus cash_in minus cash_out.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('payments', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('store_id')->constrained('stores')->cascadeOnDelete();
            $table->foreignUuid('order_id')->nullable()->constrained('orders')->cascadeOnDelete();
            $table->foreignUuid('customer_id')->nullable()->constrained('customers')->nullOnDelete();
            $table->foreignUuid('register_shift_id')->nullable()->constrained('register_shifts')->nullOnDelete();
            $table->foreignUuid('received_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('device_id')->nullable()->constrained('devices')->nullOnDelete();

            $table->string('method');
            $table->decimal('amount', 14, 2);
            $table->string('reference')->nullable();
            $table->text('notes')->nullable();

            $table->timestampTz('client_created_at')->nullable();
            $table->timestampsTz();

            $table->index(['store_id', 'created_at']);
            $table->index('order_id');
            $table->index('customer_id');
            $table->index(['register_shift_id', 'method']);
        });

        DB::statement(
            "alter table payments add constraint payments_method_check check (method in ('cash', 'card', 'transfer', 'mobile_money', 'store_credit', 'loyalty'))"
        );
        DB::statement('alter table payments add constraint payments_amount_check check (amount > 0)');
    }

    public function down(): void
    {
        Schema::dropIfExists('payments');
    }
};

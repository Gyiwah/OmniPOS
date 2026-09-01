<?php

namespace Tests\Feature;

use App\Models\Customer;
use App\Models\Order;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\RegisterShift;
use App\Models\Store;
use App\Models\StoreMember;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Every report endpoint, called at least once.
 *
 * This file exists because /api/reports/inventory threw on every request — both
 * products and product_batches carry expiry_date, and the unqualified column
 * made Postgres refuse the query outright. It had no client until the web
 * reports screen was built, and no test, so it had never once been run.
 *
 * The assertions are deliberately shallow. The point is not to pin the numbers;
 * it is that an endpoint nobody calls yet still gets called by something.
 */
class ReportEndpointTest extends TestCase
{
    use DatabaseTransactions;

    private Store $store;
    private User $manager;
    private User $cashier;

    protected function setUp(): void
    {
        parent::setUp();

        $owner = $this->makeUser();
        $this->manager = $this->makeUser();
        $this->cashier = $this->makeUser();

        $this->store = Store::create(['name' => 'Test Store', 'owner_user_id' => $owner->id]);

        foreach ([[$this->manager, StoreMember::ROLE_MANAGER], [$this->cashier, StoreMember::ROLE_CASHIER]] as [$u, $r]) {
            StoreMember::create(['store_id' => $this->store->id, 'user_id' => $u->id, 'role' => $r]);
        }
    }

    private function makeUser(): User
    {
        return User::create([
            'name' => 'U', 'email' => Str::uuid7().'@test', 'password' => Hash::make('password'),
        ]);
    }

    private function as(User $user)
    {
        return $this->actingAs($user)->withHeaders([
            'X-Store-Id' => $this->store->id,
            'Accept' => 'application/json',
        ]);
    }

    private function product(): Product
    {
        return Product::create([
            'store_id' => $this->store->id, 'name' => 'Widget', 'sku' => 'W-'.Str::random(6),
            'price' => 10, 'cost_price' => 6, 'stock' => 2, 'reorder_level' => 5,
        ]);
    }

    public function test_the_dashboard_answers(): void
    {
        $this->as($this->manager)->getJson('/api/reports/dashboard')
            ->assertOk()
            ->assertJsonStructure(['sales', 'profit', 'top_products']);
    }

    /**
     * A sale rung up offline yesterday and synced today belongs to yesterday in
     * every figure, including its tender. Windowing payments on server time put
     * the order's total in one day and its cash in another, so the takings by
     * method stopped adding up to the day's sales — for exactly the shops that
     * work offline and most need them to.
     */
    public function test_takings_by_method_follow_when_the_money_changed_hands(): void
    {
        $yesterday = now()->subDay();

        $order = Order::create([
            'id' => (string) Str::uuid7(), 'store_id' => $this->store->id,
            'order_number' => 'OM-'.Str::random(6), 'status' => 'completed',
            'subtotal' => 40, 'tax' => 0, 'discount' => 0, 'total' => 40,
            'amount_paid' => 40, 'change_due' => 0, 'payment_method' => 'cash',
            'cashier_user_id' => $this->cashier->id,
            'client_created_at' => $yesterday,
        ]);

        // Recorded on the server today, but taken from the customer yesterday.
        \App\Models\Payment::create([
            'id' => (string) Str::uuid7(), 'store_id' => $this->store->id,
            'order_id' => $order->id, 'received_by_user_id' => $this->cashier->id,
            'method' => 'cash', 'amount' => 40, 'client_created_at' => $yesterday,
        ]);

        $today = $this->as($this->manager)->getJson('/api/reports/dashboard')->assertOk();
        $this->assertSame([], $today->json('payments_by_method'), "yesterday's cash is not today's");
        $this->assertSame('0', $today->json('sales.gross'));

        $range = $yesterday->toDateString();
        $then = $this->as($this->manager)->getJson("/api/reports/dashboard?from={$range}&to={$range}")->assertOk();

        $this->assertSame('40.00', $then->json('payments_by_method.cash.total'));
        // gross comes back unpadded when the sum is an integer; parse rather
        // than string-compare, as every client does.
        $this->assertSame(40.0, (float) $then->json('sales.gross'));
    }

    public function test_sales_answers(): void
    {
        $this->as($this->manager)->getJson('/api/reports/sales?group_by=day')
            ->assertOk()
            ->assertJsonStructure(['series', 'totals']);
    }

    public function test_profit_answers(): void
    {
        $this->product();

        $this->as($this->manager)->getJson('/api/reports/profit')
            ->assertOk()
            ->assertJsonStructure(['revenue_with_known_cost', 'cogs', 'gross_profit', 'by_product']);
    }

    public function test_cashiers_answers_including_drawer_variance(): void
    {
        RegisterShift::create([
            'id' => (string) Str::uuid7(), 'store_id' => $this->store->id,
            'cashier_user_id' => $this->cashier->id, 'opened_at' => now()->subHours(3),
            'closed_at' => now(), 'opening_float' => 100, 'actual_cash' => 95,
            'expected_cash' => 100, 'discrepancy' => -5, 'status' => 'closed',
        ]);

        Order::create([
            'id' => (string) Str::uuid7(), 'store_id' => $this->store->id,
            'order_number' => 'OM-'.Str::random(6), 'status' => 'completed',
            'subtotal' => 40, 'tax' => 0, 'discount' => 0, 'total' => 40,
            'amount_paid' => 40, 'change_due' => 0, 'payment_method' => 'cash',
            'cashier_user_id' => $this->cashier->id, 'client_created_at' => now(),
        ]);

        $response = $this->as($this->manager)->getJson('/api/reports/cashiers')->assertOk();

        $row = collect($response->json('cashiers'))->firstWhere('user_id', $this->cashier->id);

        $this->assertNotNull($row);
        $this->assertSame(1, $row['orders']);
        $this->assertSame(1, $row['shifts']);
        $this->assertSame('-5.00', $row['cash_variance']);
    }

    public function test_customers_answers(): void
    {
        Customer::create([
            'id' => (string) Str::uuid7(), 'store_id' => $this->store->id,
            'name' => 'Ama Mensah', 'total_spend' => 100, 'outstanding_balance' => 40,
        ]);

        $this->as($this->manager)->getJson('/api/reports/customers')
            ->assertOk()
            ->assertJsonPath('total_outstanding', '40')
            ->assertJsonCount(1, 'debtors');
    }

    /**
     * The regression. products and product_batches both have expiry_date, so an
     * unqualified reference makes Postgres refuse the whole query — a batch with
     * an expiry date is all it takes to reach it.
     */
    public function test_inventory_answers_when_a_batch_has_an_expiry_date(): void
    {
        $product = $this->product();

        ProductBatch::create([
            'store_id' => $this->store->id, 'product_id' => $product->id,
            'batch_number' => 'B-1', 'quantity' => 12, 'cost_price' => 6,
            'expiry_date' => now()->addDays(10)->toDateString(),
        ]);

        $response = $this->as($this->manager)->getJson('/api/reports/inventory')
            ->assertOk()
            ->assertJsonStructure(['low_stock', 'oversold', 'expiring_batches']);

        $this->assertCount(1, $response->json('expiring_batches'));
        $this->assertSame('B-1', $response->json('expiring_batches.0.batch_number'));
        // stock 2 against a reorder level of 5.
        $this->assertCount(1, $response->json('low_stock'));
    }

    public function test_inventory_reports_stock_that_went_negative(): void
    {
        Product::create([
            'store_id' => $this->store->id, 'name' => 'Oversold', 'sku' => 'O-'.Str::random(6),
            'price' => 5, 'stock' => -3, 'reorder_level' => 0,
        ]);

        $response = $this->as($this->manager)->getJson('/api/reports/inventory')->assertOk();

        // Negative stock is allowed on purpose — a till never refuses a sale the
        // shop can physically fulfil — so it has to be surfaced somewhere.
        $this->assertCount(1, $response->json('oversold'));
    }

    /** Cost prices are commercially sensitive; the same boundary hides them on a product. */
    public function test_a_cashier_cannot_see_profit(): void
    {
        $this->as($this->cashier)->getJson('/api/reports/profit')->assertForbidden();
    }
}

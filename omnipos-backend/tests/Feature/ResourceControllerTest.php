<?php

namespace Tests\Feature;

use App\Models\Customer;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Payment;
use App\Models\Product;
use App\Models\Store;
use App\Models\StoreMember;
use App\Models\User;
use App\Services\InventoryService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Behaviour of the resource controllers, exercised over HTTP.
 *
 * Focused on the properties that would cost money or leak data if they broke,
 * rather than on CRUD plumbing that Laravel already guarantees.
 */
class ResourceControllerTest extends TestCase
{
    use DatabaseTransactions;

    private Store $store;
    private User $admin;
    private User $manager;
    private User $cashier;

    protected function setUp(): void
    {
        parent::setUp();

        $this->admin = $this->makeUser();
        $this->manager = $this->makeUser();
        $this->cashier = $this->makeUser();

        $this->store = Store::create(['name' => 'Test Store', 'owner_user_id' => $this->admin->id]);

        foreach ([
            [$this->admin, StoreMember::ROLE_ADMIN],
            [$this->manager, StoreMember::ROLE_MANAGER],
            [$this->cashier, StoreMember::ROLE_CASHIER],
        ] as [$user, $role]) {
            StoreMember::create(['store_id' => $this->store->id, 'user_id' => $user->id, 'role' => $role]);
        }
    }

    private function makeUser(): User
    {
        return User::create([
            'name' => 'U',
            'email' => Str::uuid7().'@test',
            'password' => Hash::make('password'),
        ]);
    }

    private function as(User $user)
    {
        return $this->actingAs($user)->withHeaders(['X-Store-Id' => $this->store->id]);
    }

    private function makeProduct(array $attrs = []): Product
    {
        return Product::create(array_merge([
            'store_id' => $this->store->id,
            'name' => 'Widget',
            'sku' => 'SKU-'.Str::random(6),
            'price' => 10,
            'cost_price' => 6,
            'stock' => 0,
            'reorder_level' => 5,
        ], $attrs));
    }

    // ------------------------------------------------------------ cost privacy

    public function test_cost_price_is_hidden_from_a_cashier_but_shown_to_a_manager(): void
    {
        $product = $this->makeProduct();

        $this->as($this->cashier)->getJson("/api/products/{$product->id}")
            ->assertOk()
            ->assertJsonMissingPath('data.cost_price')
            ->assertJsonMissingPath('data.margin')
            ->assertJsonPath('data.price', '10.00');

        $this->as($this->manager)->getJson("/api/products/{$product->id}")
            ->assertOk()
            ->assertJsonPath('data.cost_price', '6.00')
            // (10 - 6) / 10 * 100
            ->assertJsonPath('data.margin', '40.00');
    }

    public function test_a_cashier_cannot_read_stock_valuation_or_profit(): void
    {
        $this->as($this->cashier)->getJson('/api/inventory/valuation')->assertForbidden();
        $this->as($this->cashier)->getJson('/api/reports/profit')->assertForbidden();

        $this->as($this->manager)->getJson('/api/inventory/valuation')->assertOk();
    }

    public function test_a_cashier_cannot_create_or_delete_products(): void
    {
        $this->as($this->cashier)
            ->postJson('/api/products', ['name' => 'X', 'sku' => 'X-1', 'price' => 1])
            ->assertForbidden();

        $product = $this->makeProduct();
        $this->as($this->cashier)->deleteJson("/api/products/{$product->id}")->assertForbidden();
    }

    // ------------------------------------------------------------ tenancy

    public function test_a_product_from_another_store_is_not_reachable_by_id(): void
    {
        $outsider = $this->makeUser();
        $otherStore = Store::create(['name' => 'Other', 'owner_user_id' => $outsider->id]);
        $foreign = Product::create([
            'store_id' => $otherStore->id, 'name' => 'Secret', 'sku' => 'S-1', 'price' => 5, 'stock' => 0,
        ]);

        // A valid id, a real record — but not this tenant's.
        $this->as($this->admin)->getJson("/api/products/{$foreign->id}")->assertNotFound();
    }

    // ------------------------------------------------------------ inventory

    public function test_opening_stock_enters_through_the_ledger_not_as_a_column_write(): void
    {
        $response = $this->as($this->manager)->postJson('/api/products', [
            'name' => 'Ledgered', 'sku' => 'LED-1', 'price' => 10, 'cost_price' => 5, 'stock' => 25,
        ])->assertCreated();

        $id = $response->json('data.id');

        $this->assertSame(25, (int) Product::find($id)->stock);
        $this->assertSame(25.0, app(InventoryService::class)->ledgerBalance($id));
        $this->assertDatabaseHas('stock_movements', [
            'product_id' => $id, 'type' => 'STOCK_IN', 'reason' => 'Opening stock',
        ]);
    }

    public function test_updating_a_product_cannot_set_stock_directly(): void
    {
        $product = $this->makeProduct(['stock' => 10]);

        $this->as($this->manager)
            ->patchJson("/api/products/{$product->id}", ['name' => 'Renamed', 'stock' => 9999])
            ->assertOk();

        $this->assertSame('Renamed', $product->refresh()->name);
        $this->assertSame(10, (int) $product->stock, 'stock must only move through the ledger');
    }

    public function test_a_price_change_writes_price_history(): void
    {
        $product = $this->makeProduct(['price' => 10]);

        $this->as($this->manager)->patchJson("/api/products/{$product->id}", [
            'price' => 12.50, 'price_change_reason' => 'Supplier increase',
        ])->assertOk();

        $this->assertDatabaseHas('price_history', [
            'product_id' => $product->id,
            'old_sell_price' => '10.00',
            'new_sell_price' => '12.50',
            'reason' => 'Supplier increase',
            'user_id' => $this->manager->id,
        ]);
    }

    public function test_a_stock_take_posts_the_difference_as_an_audit_movement(): void
    {
        $product = $this->makeProduct();
        app(InventoryService::class)->recordMovement(
            (string) Str::uuid7(), $product, 'STOCK_IN', 20, 'Delivery'
        );

        $this->as($this->manager)->postJson('/api/inventory/stock-take', [
            'reference' => 'Monday count',
            'counts' => [['product_id' => $product->id, 'counted' => 17]],
        ])->assertOk()->assertJsonPath('adjusted_count', 1);

        $this->assertSame(17, (int) $product->refresh()->stock);
        $this->assertDatabaseHas('stock_movements', [
            'product_id' => $product->id, 'type' => 'AUDIT', 'quantity' => '-3.00',
        ]);
    }

    public function test_a_cashier_may_adjust_stock_but_not_run_a_stock_take(): void
    {
        $product = $this->makeProduct();

        $this->as($this->cashier)->postJson('/api/stock-movements', [
            'product_id' => $product->id, 'type' => 'DAMAGE', 'quantity' => -2, 'reason' => 'Broken',
        ])->assertCreated();

        $this->as($this->cashier)->postJson('/api/inventory/stock-take', [
            'counts' => [['product_id' => $product->id, 'counted' => 100]],
        ])->assertForbidden();
    }

    // ------------------------------------------------------------ customers

    public function test_customer_balances_cannot_be_set_by_the_client(): void
    {
        $response = $this->as($this->cashier)->postJson('/api/customers', [
            'name' => 'Ama',
            'total_spend' => 999999,
            'outstanding_balance' => 999999,
        ])->assertCreated();

        $this->assertSame('0.00', $response->json('data.total_spend'));
        $this->assertSame('0.00', $response->json('data.outstanding_balance'));
    }

    public function test_settling_a_debt_records_a_payment_and_recomputes_the_balance(): void
    {
        $customer = Customer::create(['store_id' => $this->store->id, 'name' => 'Debtor']);

        $order = Order::create([
            'store_id' => $this->store->id,
            'cashier_user_id' => $this->cashier->id,
            'customer_id' => $customer->id,
            'order_number' => 'T-1',
            'status' => 'completed',
            'subtotal' => 100, 'total' => 100, 'amount_paid' => 40,
            'client_created_at' => now(),
        ]);
        Payment::create([
            'store_id' => $this->store->id, 'order_id' => $order->id, 'customer_id' => $customer->id,
            'method' => 'cash', 'amount' => 40,
        ]);
        app(\App\Services\CustomerLedger::class)->recompute($customer);

        $this->assertSame('60.00', $customer->refresh()->outstanding_balance);

        $this->as($this->cashier)->postJson("/api/customers/{$customer->id}/payments", [
            'amount' => 25, 'method' => 'cash', 'order_id' => $order->id,
        ])->assertCreated()->assertJsonPath('customer.outstanding_balance', '35.00');

        $this->assertSame('65.00', $order->refresh()->amount_paid);
    }

    public function test_overpaying_an_order_does_not_inflate_the_invoice(): void
    {
        $customer = Customer::create(['store_id' => $this->store->id, 'name' => 'Overpayer']);
        $order = Order::create([
            'store_id' => $this->store->id,
            'cashier_user_id' => $this->cashier->id,
            'customer_id' => $customer->id,
            'order_number' => 'T-2', 'status' => 'completed',
            'subtotal' => 50, 'total' => 50, 'amount_paid' => 0,
            'client_created_at' => now(),
        ]);

        $this->as($this->cashier)->postJson("/api/customers/{$customer->id}/payments", [
            'amount' => 80, 'method' => 'cash', 'order_id' => $order->id,
        ])->assertCreated();

        $this->assertSame('50.00', $order->refresh()->amount_paid,
            'amount_paid is capped at the order total; the surplus stays on the account');
    }

    public function test_a_customer_with_debt_cannot_be_deleted(): void
    {
        $customer = Customer::create([
            'store_id' => $this->store->id, 'name' => 'Owes', 'outstanding_balance' => 25,
        ]);

        $this->as($this->manager)->deleteJson("/api/customers/{$customer->id}")
            ->assertStatus(422)
            ->assertJsonPath('outstanding_balance', '25.00');

        $this->assertNotSoftDeleted('customers', ['id' => $customer->id]);
    }

    // ------------------------------------------------------------ orders

    public function test_orders_cannot_be_created_over_rest_only_through_sync(): void
    {
        // No POST /api/orders route exists: sales have exactly one write path.
        $this->as($this->cashier)->postJson('/api/orders', ['order_number' => 'X'])
            ->assertStatus(405);
    }

    public function test_voiding_an_order_restocks_through_the_ledger_and_is_audited(): void
    {
        $product = $this->makeProduct();
        app(InventoryService::class)->recordMovement((string) Str::uuid7(), $product, 'STOCK_IN', 10, 'Delivery');

        $order = Order::create([
            'store_id' => $this->store->id,
            'cashier_user_id' => $this->cashier->id,
            'order_number' => 'V-1', 'status' => 'completed',
            'subtotal' => 30, 'total' => 30, 'amount_paid' => 30,
            'client_created_at' => now(),
        ]);
        OrderItem::create([
            'order_id' => $order->id, 'store_id' => $this->store->id, 'product_id' => $product->id,
            'product_name' => 'Widget', 'unit_price' => 10, 'quantity' => 3, 'line_total' => 30,
        ]);
        app(InventoryService::class)->recordMovement((string) Str::uuid7(), $product, 'SALE', -3, 'Sale V-1');

        $this->assertSame(7, (int) $product->refresh()->stock);

        $this->as($this->manager)->postJson("/api/orders/{$order->id}/void", [
            'reason' => 'Rung up twice',
        ])->assertOk()->assertJsonPath('restocked', true);

        $this->assertSame('voided', $order->refresh()->status);
        $this->assertSame(10, (int) $product->refresh()->stock);
        $this->assertDatabaseHas('audit_logs', [
            'action' => 'order.voided', 'entity_id' => $order->id, 'user_id' => $this->manager->id,
        ]);
    }

    /**
     * A sale entered twice moved stock once, not twice. Restocking a void of the
     * duplicate would invent inventory that was never on the shelf.
     */
    public function test_a_void_can_leave_the_stock_alone(): void
    {
        $product = $this->makeProduct();
        app(InventoryService::class)->recordMovement((string) Str::uuid7(), $product, 'STOCK_IN', 10, 'Delivery');

        $order = Order::create([
            'store_id' => $this->store->id,
            'cashier_user_id' => $this->cashier->id,
            'order_number' => 'V-3', 'status' => 'completed',
            'subtotal' => 20, 'total' => 20, 'amount_paid' => 20,
            'client_created_at' => now(),
        ]);
        OrderItem::create([
            'order_id' => $order->id, 'store_id' => $this->store->id, 'product_id' => $product->id,
            'product_name' => 'Widget', 'unit_price' => 10, 'quantity' => 2, 'line_total' => 20,
        ]);

        $this->as($this->manager)->postJson("/api/orders/{$order->id}/void", [
            'reason' => 'Duplicate entry', 'restock' => false,
        ])->assertOk()->assertJsonPath('restocked', false);

        $this->assertSame('voided', $order->refresh()->status);
        $this->assertSame(10, (int) $product->refresh()->stock, 'nothing should have been put back');
    }

    /** Voiding twice would restock twice, inventing stock out of a second click. */
    public function test_an_order_cannot_be_voided_twice(): void
    {
        $order = Order::create([
            'store_id' => $this->store->id,
            'cashier_user_id' => $this->cashier->id,
            'order_number' => 'V-4', 'status' => 'completed',
            'subtotal' => 10, 'total' => 10, 'client_created_at' => now(),
        ]);

        $this->as($this->manager)->postJson("/api/orders/{$order->id}/void", ['reason' => 'first'])->assertOk();

        $this->as($this->manager)->postJson("/api/orders/{$order->id}/void", ['reason' => 'second'])
            ->assertStatus(422);
    }

    public function test_a_void_requires_a_reason(): void
    {
        $order = Order::create([
            'store_id' => $this->store->id,
            'cashier_user_id' => $this->cashier->id,
            'order_number' => 'V-5', 'status' => 'completed',
            'subtotal' => 10, 'total' => 10, 'client_created_at' => now(),
        ]);

        $this->as($this->manager)->postJson("/api/orders/{$order->id}/void", [])->assertStatus(422);
        $this->assertSame('completed', $order->refresh()->status);
    }

    /**
     * The ledger is the evidence behind a stock figure, and reading it is how
     * anyone answers "why does it say 12 when there are 9 on the shelf".
     */
    public function test_a_products_movement_history_is_readable(): void
    {
        $product = $this->makeProduct();
        $inventory = app(InventoryService::class);

        $inventory->recordMovement((string) Str::uuid7(), $product, 'STOCK_IN', 10, 'Delivery');
        $inventory->recordMovement((string) Str::uuid7(), $product, 'SALE', -3, 'Sale');

        $response = $this->as($this->manager)->getJson("/api/products/{$product->id}/movements")->assertOk();

        $rows = collect($response->json('data'));

        $this->assertCount(2, $rows);
        // Newest first, and each row carries the running balance it produced.
        $this->assertSame('SALE', $rows->first()['type']);
        $this->assertSame('7.00', (string) $rows->first()['quantity_after']);
    }

    public function test_batches_can_be_filtered_to_one_product(): void
    {
        $product = $this->makeProduct();
        $other = $this->makeProduct();

        \App\Models\ProductBatch::create([
            'store_id' => $this->store->id, 'product_id' => $product->id,
            'batch_number' => 'B-1', 'quantity' => 12, 'expiry_date' => now()->addDays(20)->toDateString(),
        ]);
        \App\Models\ProductBatch::create([
            'store_id' => $this->store->id, 'product_id' => $other->id,
            'batch_number' => 'B-2', 'quantity' => 5,
        ]);

        $response = $this->as($this->manager)
            ->getJson("/api/inventory/batches?product_id={$product->id}")
            ->assertOk();

        $this->assertCount(1, $response->json('data'));
        $this->assertSame('B-1', $response->json('data.0.batch_number'));
    }

    public function test_a_cashier_cannot_void_an_order(): void
    {
        $order = Order::create([
            'store_id' => $this->store->id,
            'cashier_user_id' => $this->cashier->id,
            'order_number' => 'V-2', 'status' => 'completed',
            'subtotal' => 10, 'total' => 10, 'client_created_at' => now(),
        ]);

        $this->as($this->cashier)->postJson("/api/orders/{$order->id}/void", ['reason' => 'oops'])
            ->assertForbidden();

        $this->assertSame('completed', $order->refresh()->status);
    }

    public function test_return_eligibility_accounts_for_units_already_returned(): void
    {
        $product = $this->makeProduct();
        $order = Order::create([
            'store_id' => $this->store->id,
            'cashier_user_id' => $this->cashier->id,
            'order_number' => 'R-1', 'status' => 'completed',
            'subtotal' => 50, 'total' => 50, 'client_created_at' => now(),
        ]);
        $item = OrderItem::create([
            'order_id' => $order->id, 'store_id' => $this->store->id, 'product_id' => $product->id,
            'product_name' => 'Widget', 'unit_price' => 10, 'quantity' => 5, 'line_total' => 50,
        ]);

        $return = \App\Models\SaleReturn::create([
            'store_id' => $this->store->id, 'order_id' => $order->id,
            'processed_by_user_id' => $this->manager->id, 'amount' => 20, 'client_created_at' => now(),
        ]);
        \App\Models\ReturnItem::create([
            'return_id' => $return->id, 'store_id' => $this->store->id, 'order_item_id' => $item->id,
            'product_id' => $product->id, 'product_name' => 'Widget',
            'unit_price' => 10, 'quantity' => 2, 'line_total' => 20,
        ]);

        $this->as($this->cashier)->getJson("/api/returns/eligibility/{$order->id}")
            ->assertOk()
            ->assertJsonPath('lines.0.quantity_sold', 5)
            ->assertJsonPath('lines.0.quantity_returned', 2)
            ->assertJsonPath('lines.0.quantity_eligible', 3)
            ->assertJsonPath('refundable_total', '30.00');
    }

    /**
     * Re-issuing a clashing receipt cannot derive the next number locally — a
     * till that was offline does not know which numbers the other tills used,
     * which is what caused the clash. Only the server sees them all.
     *
     * The first implementation cast the suffix inside SQL with a bound offset,
     * which silently returned null and handed back a number that was already
     * taken, so the re-issue collided again.
     */
    public function test_next_order_number_skips_every_number_already_taken(): void
    {
        $prefix = 'OM-'.now()->format('Ymd').'-';

        foreach (['0001', '0002', '0003'] as $n) {
            Order::create([
                'store_id' => $this->store->id,
                'cashier_user_id' => $this->cashier->id,
                'order_number' => $prefix.$n,
                'status' => 'completed',
                'subtotal' => 5, 'total' => 5, 'client_created_at' => now(),
            ]);
        }

        $this->as($this->cashier)->getJson('/api/orders/next-number')
            ->assertOk()
            ->assertJsonPath('order_number', $prefix.'0004');
    }

    public function test_next_order_number_starts_at_one_when_the_day_is_empty(): void
    {
        $this->as($this->cashier)->getJson('/api/orders/next-number')
            ->assertOk()
            ->assertJsonPath('order_number', 'OM-'.now()->format('Ymd').'-0001');
    }

    /** A soft-deleted order still owns its receipt number; reusing it would clash. */
    public function test_next_order_number_respects_soft_deleted_orders(): void
    {
        $prefix = 'OM-'.now()->format('Ymd').'-';

        $order = Order::create([
            'store_id' => $this->store->id,
            'cashier_user_id' => $this->cashier->id,
            'order_number' => $prefix.'0009',
            'status' => 'completed',
            'subtotal' => 5, 'total' => 5, 'client_created_at' => now(),
        ]);
        $order->delete();

        $this->as($this->cashier)->getJson('/api/orders/next-number')
            ->assertOk()
            ->assertJsonPath('order_number', $prefix.'0010');
    }

    // ------------------------------------------------------------ register

    public function test_a_cashier_cannot_open_two_shifts_at_once(): void
    {
        $this->as($this->cashier)->postJson('/api/register-shifts', ['opening_float' => 100])
            ->assertCreated();

        $this->as($this->cashier)->postJson('/api/register-shifts', ['opening_float' => 50])
            ->assertStatus(409);
    }

    public function test_expected_cash_is_derived_from_the_payment_ledger_not_the_client(): void
    {
        $open = $this->as($this->cashier)
            ->postJson('/api/register-shifts', ['opening_float' => 100])
            ->assertCreated();
        $shiftId = $open->json('data.id');

        Payment::create([
            'store_id' => $this->store->id, 'register_shift_id' => $shiftId,
            'method' => 'cash', 'amount' => 250,
        ]);
        // Card money must not land in the drawer expectation.
        Payment::create([
            'store_id' => $this->store->id, 'register_shift_id' => $shiftId,
            'method' => 'card', 'amount' => 500,
        ]);

        $this->as($this->cashier)->postJson("/api/register-shifts/{$shiftId}/cash-movement", [
            'direction' => 'out', 'amount' => 30, 'reason' => 'Paid the window cleaner',
        ])->assertOk();

        // 100 float + 250 cash - 30 paid out = 320
        $this->as($this->cashier)->getJson('/api/register-shifts/current')
            ->assertOk()
            ->assertJsonPath('shift.expected_cash', '320.00');

        $this->as($this->cashier)->postJson("/api/register-shifts/{$shiftId}/close", [
            'actual_cash' => 315,
        ])->assertOk()
            ->assertJsonPath('shift.discrepancy', '-5.00');

        $this->assertDatabaseHas('audit_logs', ['action' => 'shift.closed_with_discrepancy']);
    }

    public function test_a_cashier_cannot_close_another_cashiers_drawer(): void
    {
        $other = $this->makeUser();
        StoreMember::create([
            'store_id' => $this->store->id, 'user_id' => $other->id, 'role' => StoreMember::ROLE_CASHIER,
        ]);

        $shiftId = $this->as($other)->postJson('/api/register-shifts', ['opening_float' => 10])
            ->assertCreated()->json('data.id');

        $this->as($this->cashier)->postJson("/api/register-shifts/{$shiftId}/close", ['actual_cash' => 10])
            ->assertForbidden();

        // A manager may, because reconciling a drawer someone walked away from
        // is a real thing that has to be possible.
        $this->as($this->manager)->postJson("/api/register-shifts/{$shiftId}/close", ['actual_cash' => 10])
            ->assertOk();
    }

    // ------------------------------------------------------------ staff

    public function test_a_manager_cannot_grant_the_admin_role(): void
    {
        $member = StoreMember::where('store_id', $this->store->id)
            ->where('user_id', $this->cashier->id)->first();

        $this->as($this->manager)
            ->patchJson("/api/store-members/{$member->id}", ['role' => 'admin'])
            ->assertForbidden();

        $this->as($this->manager)
            ->patchJson("/api/store-members/{$member->id}", ['role' => 'manager'])
            ->assertOk();
    }

    public function test_the_last_admin_cannot_be_removed_or_demoted(): void
    {
        $member = StoreMember::where('store_id', $this->store->id)
            ->where('user_id', $this->admin->id)->first();

        $this->as($this->admin)->deleteJson("/api/store-members/{$member->id}")
            ->assertStatus(422);

        $this->as($this->admin)->patchJson("/api/store-members/{$member->id}", ['role' => 'cashier'])
            ->assertStatus(422);
    }

    public function test_a_cashier_cannot_list_staff(): void
    {
        $this->as($this->cashier)->getJson('/api/store-members')->assertForbidden();
    }

    // ------------------------------------------------------------ reports

    public function test_reports_group_by_till_time_not_server_receipt_time(): void
    {
        // A sale rung up yesterday on an offline terminal that only synced today.
        Order::create([
            'store_id' => $this->store->id,
            'cashier_user_id' => $this->cashier->id,
            'order_number' => 'OFF-1', 'status' => 'completed',
            'subtotal' => 80, 'total' => 80, 'amount_paid' => 80,
            'client_created_at' => now()->subDay()->setTime(14, 0),
        ]);

        // Today's dashboard must not claim it.
        $this->as($this->manager)->getJson('/api/reports/dashboard')
            ->assertOk()
            ->assertJsonPath('sales.orders', 0);

        // Yesterday's range must.
        $this->as($this->manager)->getJson('/api/reports/sales?'.http_build_query([
            'from' => now()->subDay()->toDateString(),
            'to' => now()->subDay()->toDateString(),
        ]))->assertOk()->assertJsonPath('totals.orders', 1);
    }

    public function test_profit_excludes_lines_with_no_recorded_cost(): void
    {
        $product = $this->makeProduct();
        $order = Order::create([
            'store_id' => $this->store->id,
            'cashier_user_id' => $this->cashier->id,
            'order_number' => 'P-1', 'status' => 'completed',
            'subtotal' => 40, 'total' => 40, 'client_created_at' => now(),
        ]);
        // One line with a known cost, one without (an imported historical line).
        OrderItem::create([
            'order_id' => $order->id, 'store_id' => $this->store->id, 'product_id' => $product->id,
            'product_name' => 'Widget', 'unit_price' => 10, 'quantity' => 2, 'line_total' => 20,
            'unit_cost' => 6,
        ]);
        OrderItem::create([
            'order_id' => $order->id, 'store_id' => $this->store->id, 'product_id' => $product->id,
            'product_name' => 'Widget', 'unit_price' => 10, 'quantity' => 2, 'line_total' => 20,
            'unit_cost' => null,
        ]);

        $this->as($this->manager)->getJson('/api/reports/profit')
            ->assertOk()
            // Only the costed line counts: 20 revenue - 12 cogs.
            ->assertJsonPath('revenue_with_known_cost', '20.00')
            ->assertJsonPath('cogs', '12.00')
            ->assertJsonPath('gross_profit', '8.00')
            ->assertJsonPath('lines_without_cost', 1);
    }
}

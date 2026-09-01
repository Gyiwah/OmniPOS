<?php

namespace Tests\Feature;

use App\Models\Device;
use App\Models\Order;
use App\Models\Payment;
use App\Models\Customer;
use App\Models\Product;
use App\Models\Store;
use App\Models\StoreMember;
use App\Models\User;
use App\Services\InventoryService;
use App\Services\Sync\SyncService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * The guarantees the offline-first design rests on. If any of these break, the
 * system loses or duplicates money.
 */
class SyncTest extends TestCase
{
    use DatabaseTransactions;

    private Store $store;

    private User $cashier;

    private Device $device;

    protected function setUp(): void
    {
        parent::setUp();

        $owner = User::create([
            'name' => 'Owner', 'email' => 'owner-'.Str::uuid7().'@test', 'password' => 'x',
        ]);

        $this->store = Store::create(['name' => 'Test Store', 'owner_user_id' => $owner->id]);

        $this->cashier = User::create([
            'name' => 'Cashier', 'email' => 'cashier-'.Str::uuid7().'@test', 'password' => 'x',
        ]);

        StoreMember::create([
            'store_id' => $this->store->id,
            'user_id' => $this->cashier->id,
            'role' => StoreMember::ROLE_CASHIER,
        ]);

        $this->device = Device::create([
            'id' => (string) Str::uuid7(),
            'store_id' => $this->store->id,
            'platform' => 'test',
        ]);

        $this->cashier->load('memberships');
    }

    private function product(int $stock = 20): Product
    {
        return Product::create([
            'store_id' => $this->store->id,
            'name' => 'Widget',
            'sku' => 'SKU-'.Str::random(8),
            'price' => 10,
            'cost_price' => 6,
            'stock' => $stock,
        ]);
    }

    private function orderOperation(Product $product, int $qty, float $total): array
    {
        return [
            'operation_id' => (string) Str::uuid7(),
            'entity' => 'orders',
            'action' => 'upsert',
            'record_id' => (string) Str::uuid7(),
            'payload' => [
                'order_number' => 'ORD-'.Str::random(6),
                'cashier_user_id' => $this->cashier->id,
                'total' => $total,
                'subtotal' => $total,
                'amount_paid' => $total,
                'payment_method' => 'cash',
                'items' => [[
                    'id' => (string) Str::uuid7(),
                    'product_id' => $product->id,
                    'product_name' => $product->name,
                    'unit_price' => 10,
                    'quantity' => $qty,
                    'line_total' => $total,
                ]],
            ],
        ];
    }

    private function manager(): User
    {
        $manager = User::create([
            'name' => 'Manager', 'email' => 'mgr-'.Str::uuid7().'@test', 'password' => 'x',
        ]);
        StoreMember::create([
            'store_id' => $this->store->id, 'user_id' => $manager->id, 'role' => StoreMember::ROLE_MANAGER,
        ]);

        return $manager->load('memberships');
    }

    private function sync(): SyncService
    {
        return app(SyncService::class);
    }

    public function test_a_pushed_order_creates_the_sale_its_lines_its_payment_and_its_stock_movement(): void
    {
        $product = $this->product(20);
        $op = $this->orderOperation($product, 3, 30);

        $result = $this->sync()->push($this->store->id, $this->cashier, $this->device, [$op]);

        $this->assertSame(1, $result['applied'], 'order should have been applied');

        $order = Order::find($op['record_id']);
        $this->assertNotNull($order, 'order row missing');
        $this->assertCount(1, $order->items);
        $this->assertSame(1, $order->payments()->count(), 'legacy single-tender payload should synthesise a payment row');
        $this->assertSame('30.00', (string) $order->payments()->first()->amount);

        // Stock came down through the ledger, not by overwriting a number.
        $this->assertSame(17, (int) $product->fresh()->stock);
        $this->assertSame(-3.0, app(InventoryService::class)->ledgerBalance($product->id) - 20.0);
    }

    public function test_replaying_the_same_operation_id_does_not_book_the_sale_twice(): void
    {
        $product = $this->product(20);
        $op = $this->orderOperation($product, 3, 30);

        $first = $this->sync()->push($this->store->id, $this->cashier, $this->device, [$op]);
        // The client never saw the response and retries the identical operation.
        $second = $this->sync()->push($this->store->id, $this->cashier, $this->device, [$op]);

        $this->assertSame(1, $first['applied']);
        $this->assertSame(1, $second['duplicates'], 'retry must be recognised as a duplicate');
        $this->assertSame(0, $second['applied']);

        $this->assertSame(1, Order::where('id', $op['record_id'])->count());
        $this->assertSame(1, Payment::where('order_id', $op['record_id'])->count());
        $this->assertSame(17, (int) $product->fresh()->stock, 'stock must not be decremented twice');
    }

    public function test_two_offline_devices_selling_the_same_product_both_apply(): void
    {
        // This is the scenario that made the ledger necessary. Both tills believed
        // stock was 20; had they synced absolute values, one sale would vanish.
        $product = $this->product(20);

        $tillA = $this->orderOperation($product, 5, 50);
        $tillB = $this->orderOperation($product, 8, 80);

        $this->sync()->push($this->store->id, $this->cashier, $this->device, [$tillA]);
        $this->sync()->push($this->store->id, $this->cashier, $this->device, [$tillB]);

        $this->assertSame(7, (int) $product->fresh()->stock, '20 - 5 - 8 must be 7');
    }

    public function test_a_duplicate_order_number_is_reported_as_a_conflict_not_silently_renumbered(): void
    {
        $product = $this->product(50);

        $first = $this->orderOperation($product, 1, 10);
        $second = $this->orderOperation($product, 1, 10);
        $second['payload']['order_number'] = $first['payload']['order_number'];

        $this->sync()->push($this->store->id, $this->cashier, $this->device, [$first]);
        $result = $this->sync()->push($this->store->id, $this->cashier, $this->device, [$second]);

        $this->assertSame(1, $result['conflicts']);
        $this->assertSame('conflict', $result['results'][0]['status']);
        $this->assertStringContainsString('already exists', $result['results'][0]['reason']);
    }

    public function test_a_cashier_may_sell_but_may_not_alter_the_catalogue(): void
    {
        $op = [
            'operation_id' => (string) Str::uuid7(),
            'entity' => 'products',
            'action' => 'upsert',
            'record_id' => (string) Str::uuid7(),
            'payload' => ['name' => 'Sneaky', 'sku' => 'SNEAK-1', 'price' => 1],
        ];

        $result = $this->sync()->push($this->store->id, $this->cashier, $this->device, [$op]);

        $this->assertSame(1, $result['conflicts'], 'cashier must not be able to write products');
        $this->assertNull(Product::find($op['record_id']));
    }

    /**
     * Creating a record from a till, as opposed to editing one that already
     * exists.
     *
     * This gap survived because every other product test either edits an
     * existing row or asserts a rejection. Nothing pushed a NEW product as
     * someone allowed to create one — so a mass-assignment failure on the
     * client-minted id looked exactly like a passing suite, while in the field
     * no till could ever add a product.
     */
    public function test_a_manager_can_create_a_new_product_from_a_till(): void
    {
        $manager = $this->manager();
        $recordId = (string) Str::uuid7();

        $result = $this->sync()->push($this->store->id, $manager, $this->device, [[
            'operation_id' => (string) Str::uuid7(),
            'entity' => 'products',
            'action' => 'upsert',
            'record_id' => $recordId,
            'payload' => ['id' => $recordId, 'name' => 'Ginger Biscuits', 'sku' => 'GB-1', 'price' => 3.5],
        ]]);

        $this->assertSame(1, $result['applied'], $result['results'][0]['reason'] ?? 'should have applied');

        $product = Product::find($recordId);
        $this->assertNotNull($product, "the till's own id must be the server id");
        $this->assertSame('Ginger Biscuits', $product->name);
        // Stock arrives through the ledger, never as an attribute.
        $this->assertSame(0, (int) $product->stock);
    }

    public function test_a_cashier_can_register_a_new_customer_from_a_till(): void
    {
        $recordId = (string) Str::uuid7();

        $result = $this->sync()->push($this->store->id, $this->cashier, $this->device, [[
            'operation_id' => (string) Str::uuid7(),
            'entity' => 'customers',
            'action' => 'upsert',
            'record_id' => $recordId,
            'payload' => ['id' => $recordId, 'name' => 'Akosua Boateng', 'phone' => '0244000111'],
        ]]);

        $this->assertSame(1, $result['applied'], $result['results'][0]['reason'] ?? 'should have applied');
        $this->assertSame('Akosua Boateng', Customer::find($recordId)?->name);
    }

    /**
     * The opening count for a product created moments earlier.
     *
     * Pushed as one batch, which is how a till actually sends it: the product
     * and the delivery that stocked it are entered together.
     */
    public function test_a_new_product_and_its_opening_stock_apply_in_one_batch(): void
    {
        $manager = $this->manager();
        $productId = (string) Str::uuid7();

        $result = $this->sync()->push($this->store->id, $manager, $this->device, [
            [
                'operation_id' => (string) Str::uuid7(),
                'entity' => 'products',
                'action' => 'upsert',
                'record_id' => $productId,
                'payload' => ['id' => $productId, 'name' => 'Ginger Biscuits', 'sku' => 'GB-2', 'price' => 3.5],
            ],
            [
                'operation_id' => (string) Str::uuid7(),
                'entity' => 'stock_movements',
                'action' => 'upsert',
                'record_id' => (string) Str::uuid7(),
                'payload' => ['product_id' => $productId, 'type' => 'STOCK_IN', 'quantity' => 48, 'reason' => 'Opening delivery'],
            ],
        ]);

        $this->assertSame(2, $result['applied'], json_encode($result['results']));
        $this->assertSame(48, (int) Product::find($productId)->stock);
    }

    /**
     * A type the schema does not allow must come back as a sentence, not as a
     * check violation the till can only report as "could not be applied" and
     * then retry for ever.
     */
    public function test_an_unknown_stock_movement_type_is_refused_with_a_readable_reason(): void
    {
        $product = $this->product(5);

        $result = $this->sync()->push($this->store->id, $this->cashier, $this->device, [[
            'operation_id' => (string) Str::uuid7(),
            'entity' => 'stock_movements',
            'action' => 'upsert',
            'record_id' => (string) Str::uuid7(),
            'payload' => ['product_id' => $product->id, 'type' => 'PURCHASE', 'quantity' => 4, 'reason' => 'x'],
        ]]);

        $this->assertSame(1, $result['conflicts']);
        $this->assertStringContainsString('Unknown stock movement type', $result['results'][0]['reason']);
        $this->assertSame(5, (int) $product->fresh()->stock);
    }

    public function test_a_client_cannot_send_an_absolute_stock_value_to_overwrite_the_ledger(): void
    {
        $manager = User::create([
            'name' => 'Manager', 'email' => 'mgr-'.Str::uuid7().'@test', 'password' => 'x',
        ]);
        StoreMember::create([
            'store_id' => $this->store->id, 'user_id' => $manager->id, 'role' => StoreMember::ROLE_MANAGER,
        ]);
        $manager->load('memberships');

        $product = $this->product(20);

        $op = [
            'operation_id' => (string) Str::uuid7(),
            'entity' => 'products',
            'action' => 'upsert',
            'record_id' => $product->id,
            'payload' => ['name' => 'Widget', 'sku' => $product->sku, 'price' => 12, 'stock' => 9999],
        ];

        $this->sync()->push($this->store->id, $manager, $this->device, [$op]);

        $fresh = $product->fresh();
        $this->assertSame('12.00', (string) $fresh->price, 'price should update');
        $this->assertSame(20, (int) $fresh->stock, 'stock must be ignored — it belongs to the ledger');
    }

    public function test_pull_returns_changes_after_a_cursor_and_skips_the_origin_device(): void
    {
        $product = $this->product(50);
        $op = $this->orderOperation($product, 1, 10);
        $this->sync()->push($this->store->id, $this->cashier, $this->device, [$op]);

        // A second device must see the change...
        $other = Device::create([
            'id' => (string) Str::uuid7(), 'store_id' => $this->store->id, 'platform' => 'test-2',
        ]);

        // ...once it is outside the stability window.
        config(['omnipos.sync.stability_window_ms' => 0]);

        $page = $this->sync()->pull($this->store->id, 0, 500, $other);
        $this->assertNotEmpty($page['changes'], 'other device should receive the change');
        $this->assertGreaterThan(0, $page['cursor']);

        // ...and the originating device should not be sent its own work back.
        $ownPage = $this->sync()->pull($this->store->id, 0, 500, $this->device);
        $ids = array_column($ownPage['changes'], 'record_id');
        $this->assertNotContains($op['record_id'], $ids, 'origin device must not receive its own change');

        // A cursor at the head returns nothing new.
        $empty = $this->sync()->pull($this->store->id, $page['cursor'], 500, $other);
        $this->assertSame([], $empty['changes']);
    }

    public function test_an_operation_for_another_store_cannot_touch_this_stores_record(): void
    {
        $product = $this->product(20);

        $otherOwner = User::create([
            'name' => 'Other', 'email' => 'other-'.Str::uuid7().'@test', 'password' => 'x',
        ]);
        $otherStore = Store::create(['name' => 'Other Store', 'owner_user_id' => $otherOwner->id]);
        StoreMember::create([
            'store_id' => $otherStore->id, 'user_id' => $this->cashier->id, 'role' => StoreMember::ROLE_ADMIN,
        ]);
        $this->cashier->load('memberships');

        // Admin of the other store aims an upsert at this store's product id.
        $op = [
            'operation_id' => (string) Str::uuid7(),
            'entity' => 'products',
            'action' => 'upsert',
            'record_id' => $product->id,
            'payload' => ['name' => 'Hijacked', 'sku' => 'HIJACK-1', 'price' => 1],
        ];

        $result = $this->sync()->push($otherStore->id, $this->cashier, null, [$op]);

        $this->assertSame(1, $result['conflicts']);
        $this->assertSame('Widget', $product->fresh()->name, 'cross-tenant write must not land');
    }
}

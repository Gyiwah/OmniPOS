<?php

namespace Tests\Feature;

use App\Models\Device;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Payment;
use App\Models\Product;
use App\Models\RegisterShift;
use App\Models\Store;
use App\Models\StoreMember;
use App\Models\User;
use App\Services\InventoryService;
use App\Services\Sync\Handlers\ReturnHandler;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Refunds move money out of the drawer and stock back onto the shelf. The
 * checks here are the ones that stop a shop paying out more than it took.
 */
class ReturnSyncTest extends TestCase
{
    use DatabaseTransactions;

    private Store $store;
    private User $cashier;
    private Product $product;
    private Order $order;
    private OrderItem $line;

    protected function setUp(): void
    {
        parent::setUp();

        $this->cashier = User::create([
            'name' => 'Till', 'email' => Str::uuid7().'@test', 'password' => Hash::make('password'),
        ]);
        $this->store = Store::create(['name' => 'S', 'owner_user_id' => $this->cashier->id]);
        StoreMember::create([
            'store_id' => $this->store->id, 'user_id' => $this->cashier->id, 'role' => StoreMember::ROLE_CASHIER,
        ]);

        $this->product = Product::create([
            'store_id' => $this->store->id, 'name' => 'Widget', 'sku' => 'SKU-R'.Str::random(4),
            'price' => 10, 'cost_price' => 6, 'stock' => 0, 'reorder_level' => 5,
        ]);
        app(InventoryService::class)->recordMovement(
            (string) Str::uuid7(), $this->product, 'STOCK_IN', 20, 'Delivery'
        );

        $this->order = Order::create([
            'store_id' => $this->store->id,
            'cashier_user_id' => $this->cashier->id,
            'order_number' => 'R-'.Str::random(6),
            'status' => 'completed',
            'subtotal' => 50, 'total' => 50, 'amount_paid' => 50,
            'client_created_at' => now(),
        ]);
        $this->line = OrderItem::create([
            'order_id' => $this->order->id, 'store_id' => $this->store->id,
            'product_id' => $this->product->id, 'product_name' => 'Widget',
            'unit_price' => 10, 'quantity' => 5, 'line_total' => 50,
        ]);
        app(InventoryService::class)->recordMovement(
            (string) Str::uuid7(), $this->product, 'SALE', -5, 'Sale'
        );
    }

    private function push(array $payload, ?string $recordId = null, ?Device $device = null)
    {
        return app(ReturnHandler::class)->upsert(
            $this->store->id,
            $recordId ?? (string) Str::uuid7(),
            $payload,
            $this->cashier,
            $device,
        );
    }

    private function payload(int $quantity, array $over = []): array
    {
        return array_merge([
            'order_id' => $this->order->id,
            'reason' => 'Damaged',
            'amount' => 10 * $quantity,
            'refund_method' => 'cash',
            'client_created_at' => now()->toIso8601String(),
            'items' => [[
                'id' => (string) Str::uuid7(),
                'order_item_id' => $this->line->id,
                'product_id' => $this->product->id,
                'product_name' => 'Widget',
                'unit_price' => 10,
                'quantity' => $quantity,
                'line_total' => 10 * $quantity,
                'restock' => true,
            ]],
        ], $over);
    }

    /**
     * The goods come back even when the client does not say which product they
     * are. The order line already settles that, and eligibility has just proved
     * the line belongs to this sale.
     *
     * Before this, a payload without product_id refunded the money and skipped
     * the restock silently: the customer was paid and the stock stayed down for
     * ever, with nothing reporting it.
     */
    public function test_a_line_without_a_product_id_still_restocks(): void
    {
        $this->assertSame(15, (int) $this->product->refresh()->stock);

        $payload = $this->payload(2);
        unset($payload['items'][0]['product_id']);

        $outcome = $this->push($payload);
        $this->assertFalse($outcome->isConflict());

        $this->assertSame(17, (int) $this->product->refresh()->stock);
    }

    /**
     * And the order line wins over a client that names a different one. A till
     * with a stale cache would otherwise put stock back against some other
     * product, which is worse than not restocking at all: two products wrong
     * instead of one, and neither obviously.
     */
    public function test_the_order_line_wins_over_a_product_id_the_client_invented(): void
    {
        $other = Product::create([
            'store_id' => $this->store->id, 'name' => 'Not this one',
            'sku' => 'SKU-X'.Str::random(4), 'price' => 10, 'stock' => 0,
        ]);

        $payload = $this->payload(2);
        $payload['items'][0]['product_id'] = $other->id;

        $outcome = $this->push($payload);
        $this->assertFalse($outcome->isConflict());

        $this->assertSame(17, (int) $this->product->refresh()->stock);
        $this->assertSame(0, (int) $other->refresh()->stock);
    }

    public function test_a_return_restocks_through_the_ledger(): void
    {
        $this->assertSame(15, (int) $this->product->refresh()->stock);

        $outcome = $this->push($this->payload(2));
        $this->assertFalse($outcome->isConflict());

        $this->assertSame(17, (int) $this->product->refresh()->stock);
        $this->assertDatabaseHas('stock_movements', [
            'product_id' => $this->product->id, 'type' => 'RETURN', 'quantity' => '2.00',
        ]);
    }

    /**
     * A refund is money leaving the drawer, so it belongs in the payments ledger
     * as a negative row. Recording it anywhere else makes a shift reconcile
     * against sales alone and appear over by exactly the day's refunds.
     */
    public function test_a_refund_is_a_negative_payment(): void
    {
        $this->push($this->payload(2));

        $this->assertDatabaseHas('payments', [
            'order_id' => $this->order->id, 'amount' => '-20.00', 'method' => 'cash',
        ]);
    }

    public function test_a_cash_refund_reduces_the_expected_drawer_exactly_once(): void
    {
        $shift = RegisterShift::create([
            'store_id' => $this->store->id,
            'cashier_user_id' => $this->cashier->id,
            'opened_at' => now(),
            'opening_float' => 100,
            'status' => 'open',
        ]);

        Payment::create([
            'store_id' => $this->store->id, 'order_id' => $this->order->id,
            'register_shift_id' => $shift->id, 'method' => 'cash', 'amount' => 50,
        ]);

        $this->push($this->payload(2, ['register_shift_id' => $shift->id]));

        // 100 float + 50 taken - 20 refunded = 130. Subtracting the refund twice
        // would give 110 and make an honest till look short.
        $this->assertSame('130.00', $shift->refresh()->computeExpectedCash());
    }

    /**
     * The guard that stops a shop refunding more than it sold. A till decides
     * eligibility from what it knows locally, which goes stale the moment
     * another terminal processes a return against the same sale.
     */
    public function test_returning_more_than_was_sold_is_refused(): void
    {
        $outcome = $this->push($this->payload(6));

        $this->assertTrue($outcome->isConflict());
        $this->assertStringContainsString('can still be returned', $outcome->reason);
        $this->assertSame(15, (int) $this->product->refresh()->stock, 'nothing may be restocked');
        $this->assertDatabaseMissing('payments', ['amount' => '-60.00']);
    }

    public function test_returns_across_two_tills_cannot_exceed_what_was_sold(): void
    {
        // Till A refunds 3 of the 5 sold.
        $this->assertFalse($this->push($this->payload(3))->isConflict());

        // Till B, offline until now, tries to refund 3 more.
        $second = $this->push($this->payload(3));

        $this->assertTrue($second->isConflict());
        $this->assertSame(2, $second->serverState['quantity_eligible']);
        $this->assertSame(3, $second->serverState['quantity_returned']);
    }

    public function test_replaying_the_same_return_does_not_refund_or_restock_twice(): void
    {
        $recordId = (string) Str::uuid7();

        $this->push($this->payload(2), $recordId);
        $stockAfterFirst = (int) $this->product->refresh()->stock;

        $second = $this->push($this->payload(2), $recordId);

        $this->assertFalse($second->isConflict());
        $this->assertSame($stockAfterFirst, (int) $this->product->refresh()->stock);
        $this->assertSame(1, \App\Models\SaleReturn::whereKey($recordId)->count());
        $this->assertSame(1, Payment::where('order_id', $this->order->id)->where('amount', '<', 0)->count());
    }

    public function test_a_line_from_a_different_sale_is_refused(): void
    {
        $otherOrder = Order::create([
            'store_id' => $this->store->id, 'cashier_user_id' => $this->cashier->id,
            'order_number' => 'OTHER-'.Str::random(5), 'status' => 'completed',
            'subtotal' => 10, 'total' => 10, 'client_created_at' => now(),
        ]);
        $otherLine = OrderItem::create([
            'order_id' => $otherOrder->id, 'store_id' => $this->store->id,
            'product_id' => $this->product->id, 'product_name' => 'Widget',
            'unit_price' => 10, 'quantity' => 1, 'line_total' => 10,
        ]);

        $outcome = $this->push($this->payload(1, [
            'items' => [[
                'order_item_id' => $otherLine->id,
                'product_id' => $this->product->id,
                'product_name' => 'Widget',
                'unit_price' => 10, 'quantity' => 1, 'line_total' => 10, 'restock' => true,
            ]],
        ]));

        $this->assertTrue($outcome->isConflict());
        $this->assertStringContainsString('does not belong to this sale', $outcome->reason);
    }

    public function test_a_return_for_a_sale_the_server_has_not_seen_is_a_conflict(): void
    {
        $outcome = $this->push($this->payload(1, ['order_id' => (string) Str::uuid7()]));

        $this->assertTrue($outcome->isConflict());
        $this->assertStringContainsString('not on this server yet', $outcome->reason);
    }

    /** Goods too damaged to resell are refunded but not put back on the shelf. */
    public function test_a_line_marked_not_to_restock_refunds_without_restocking(): void
    {
        $payload = $this->payload(2);
        $payload['items'][0]['restock'] = false;

        $this->push($payload);

        $this->assertSame(15, (int) $this->product->refresh()->stock);
        $this->assertDatabaseHas('payments', ['amount' => '-20.00']);
    }
}

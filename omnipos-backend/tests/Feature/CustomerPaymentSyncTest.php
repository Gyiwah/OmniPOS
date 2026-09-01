<?php

namespace Tests\Feature;

use App\Models\Customer;
use App\Models\Device;
use App\Models\Order;
use App\Models\Payment;
use App\Models\Store;
use App\Models\StoreMember;
use App\Models\User;
use App\Services\Sync\SyncService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Settling a customer's balance from a till.
 *
 * Until this handler existed the only way to take money off an account was the
 * REST endpoint, which needs a connection — so a shop could put a customer into
 * debt offline but could not take them out of it. Debt accrued in one direction
 * only.
 */
class CustomerPaymentSyncTest extends TestCase
{
    use DatabaseTransactions;

    private Store $store;
    private User $cashier;
    private Device $device;
    private Customer $customer;

    protected function setUp(): void
    {
        parent::setUp();

        $owner = User::create(['name' => 'Owner', 'email' => 'own-'.Str::uuid7().'@test', 'password' => 'x']);
        $this->store = Store::create(['name' => 'Test Store', 'owner_user_id' => $owner->id]);

        $this->cashier = User::create(['name' => 'Cashier', 'email' => 'cash-'.Str::uuid7().'@test', 'password' => 'x']);
        StoreMember::create([
            'store_id' => $this->store->id, 'user_id' => $this->cashier->id, 'role' => StoreMember::ROLE_CASHIER,
        ]);
        $this->cashier->load('memberships');

        $this->device = Device::create([
            'id' => (string) Str::uuid7(), 'store_id' => $this->store->id,
            'user_id' => $this->cashier->id, 'platform' => 'web',
        ]);

        $this->customer = Customer::create([
            'id' => (string) Str::uuid7(), 'store_id' => $this->store->id, 'name' => 'Ama Mensah',
        ]);
    }

    private function creditSale(string $total, string $paid): Order
    {
        $order = Order::create([
            'id' => (string) Str::uuid7(),
            'store_id' => $this->store->id,
            'customer_id' => $this->customer->id,
            'order_number' => 'OM-'.Str::random(6),
            'status' => 'completed',
            'subtotal' => $total, 'tax' => 0, 'discount' => 0, 'total' => $total,
            'amount_paid' => $paid, 'change_due' => 0, 'payment_method' => 'cash',
            'cashier_user_id' => $this->cashier->id,
            'client_created_at' => now(),
        ]);

        // The part already paid has to exist as a payment row, not just as a
        // column on the order. outstanding_balance is derived from the ledger,
        // so a test that skips this measures a debt the shop never had.
        if (bccomp($paid, '0', 2) === 1) {
            Payment::create([
                'id' => (string) Str::uuid7(),
                'store_id' => $this->store->id,
                'order_id' => $order->id,
                'customer_id' => $this->customer->id,
                'received_by_user_id' => $this->cashier->id,
                'method' => 'cash',
                'amount' => $paid,
                'client_created_at' => now(),
            ]);
        }

        app(\App\Services\CustomerLedger::class)->recompute($this->customer);

        return $order;
    }

    private function operation(array $payload, ?string $recordId = null): array
    {
        return [
            'operation_id' => (string) Str::uuid7(),
            'entity' => 'payments',
            'action' => 'upsert',
            'record_id' => $recordId ?? (string) Str::uuid7(),
            'payload' => array_merge(['customer_id' => $this->customer->id, 'method' => 'cash'], $payload),
        ];
    }

    private function push(array $operations, ?User $user = null): array
    {
        return app(SyncService::class)->push(
            $this->store->id, $user ?? $this->cashier, $this->device, $operations
        );
    }

    public function test_a_settlement_reduces_the_customers_outstanding_balance(): void
    {
        $this->creditSale('100.00', '30.00');
        $this->assertSame('70.00', (string) $this->customer->fresh()->outstanding_balance);

        $result = $this->push([$this->operation(['amount' => 45])]);

        $this->assertSame(1, $result['applied'], $result['results'][0]['reason'] ?? '');
        $this->assertSame('25.00', (string) $this->customer->fresh()->outstanding_balance);
    }

    /**
     * The failure this guards against looks like the customer paying and the
     * debt halving twice — a retry after a dropped response must not credit
     * them again.
     */
    public function test_replaying_the_same_payment_credits_the_customer_once(): void
    {
        $this->creditSale('100.00', '0.00');
        $recordId = (string) Str::uuid7();

        $first = $this->push([$this->operation(['amount' => 40], $recordId)]);
        $second = $this->push([$this->operation(['amount' => 40], $recordId)]);

        $this->assertSame(1, $first['applied']);
        $this->assertSame(1, $second['applied'], 'a replay is a success, not a conflict');

        $this->assertSame(1, Payment::where('customer_id', $this->customer->id)->count());
        $this->assertSame('60.00', (string) $this->customer->fresh()->outstanding_balance);
    }

    /** Naming an order settles that invoice as well as the account. */
    public function test_a_payment_against_an_order_moves_that_orders_amount_paid(): void
    {
        $order = $this->creditSale('100.00', '30.00');

        $this->push([$this->operation(['amount' => 70, 'order_id' => $order->id])]);

        $this->assertSame('100.00', (string) $order->fresh()->amount_paid);
        $this->assertSame('0.00', (string) $this->customer->fresh()->outstanding_balance);
    }

    /**
     * Overpayment stays on the account rather than inflating the invoice, so
     * the order still reconciles against the receipt the customer holds.
     */
    public function test_overpaying_an_order_does_not_push_it_past_its_own_total(): void
    {
        $order = $this->creditSale('100.00', '30.00');

        $this->push([$this->operation(['amount' => 90, 'order_id' => $order->id])]);

        $this->assertSame('100.00', (string) $order->fresh()->amount_paid);
        $this->assertSame('0.00', (string) $this->customer->fresh()->outstanding_balance);
    }

    /**
     * A refund carries a restock and an eligibility check this path knows
     * nothing about. Accepting a negative here would move money without moving
     * the goods.
     */
    public function test_a_negative_amount_is_refused_and_directed_to_returns(): void
    {
        $this->creditSale('100.00', '0.00');

        $result = $this->push([$this->operation(['amount' => -20])]);

        $this->assertSame(1, $result['conflicts']);
        $this->assertStringContainsString('refunds go through returns', $result['results'][0]['reason']);
        $this->assertSame('100.00', (string) $this->customer->fresh()->outstanding_balance);
    }

    public function test_a_payment_for_a_customer_the_server_has_never_seen_is_kept_as_a_conflict(): void
    {
        $result = $this->push([[
            'operation_id' => (string) Str::uuid7(),
            'entity' => 'payments',
            'action' => 'upsert',
            'record_id' => (string) Str::uuid7(),
            'payload' => ['customer_id' => (string) Str::uuid7(), 'amount' => 10, 'method' => 'cash'],
        ]]);

        $this->assertSame(1, $result['conflicts']);
        $this->assertStringContainsString('not on this server yet', $result['results'][0]['reason']);
    }

    public function test_an_unknown_method_is_refused_with_the_list_of_real_ones(): void
    {
        $this->creditSale('50.00', '0.00');

        $result = $this->push([$this->operation(['amount' => 10, 'method' => 'crypto'])]);

        $this->assertSame(1, $result['conflicts']);
        $this->assertStringContainsString('Unknown payment method', $result['results'][0]['reason']);
    }

    /**
     * A settlement taken during a shift is cash in that drawer, so it has to
     * reach the reconciliation. Without the link the drawer counts short by
     * every debt settled during the shift.
     */
    public function test_a_cash_settlement_lands_in_the_drawer_it_was_taken_in(): void
    {
        $this->creditSale('100.00', '0.00');

        $shift = \App\Models\RegisterShift::create([
            'id' => (string) Str::uuid7(), 'store_id' => $this->store->id,
            'cashier_user_id' => $this->cashier->id, 'opened_at' => now(),
            'opening_float' => '200.00', 'status' => 'open',
        ]);

        $this->push([$this->operation(['amount' => 60, 'register_shift_id' => $shift->id])]);

        $this->assertSame('260.00', $shift->fresh()->computeExpectedCash());
    }

    public function test_payments_cannot_be_deleted(): void
    {
        $result = $this->push([[
            'operation_id' => (string) Str::uuid7(),
            'entity' => 'payments',
            'action' => 'delete',
            'record_id' => (string) Str::uuid7(),
            'payload' => [],
        ]]);

        $this->assertSame(1, $result['conflicts']);
    }
}

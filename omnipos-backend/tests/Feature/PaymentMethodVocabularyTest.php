<?php

namespace Tests\Feature;

use App\Models\Customer;
use App\Models\Device;
use App\Models\Payment;
use App\Models\Product;
use App\Models\Store;
use App\Models\StoreMember;
use App\Models\User;
use App\Services\Sync\SyncService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/**
 * What a till calls a payment method, and what this schema calls it.
 *
 * The mobile till's picker says "MoMo" and sends 'momo'. The payments table has
 * a check constraint listing 'mobile_money'. Nothing translated between them, so
 * every mobile money sale rung up on a phone failed its push against a database
 * constraint — in the market where mobile money is how most people pay. The sale
 * stayed in the outbox, and the books were short by every one of them.
 *
 * These tests are about vocabulary, not about money: the point is that a name
 * the client uses can never be the reason a sale is lost.
 */
class PaymentMethodVocabularyTest extends TestCase
{
    use DatabaseTransactions;

    private Store $store;

    private User $cashier;

    private Device $device;

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
            'user_id' => $this->cashier->id, 'platform' => 'android',
        ]);
    }

    /** One sale, pushed the way the mobile till pushes one. */
    private function sale(string $method): array
    {
        $product = Product::create([
            'id' => (string) Str::uuid7(), 'store_id' => $this->store->id,
            'name' => 'Sachet water', 'sku' => 'SW-'.Str::random(6), 'price' => '20.00', 'stock' => 50,
        ]);

        return app(SyncService::class)->push($this->store->id, $this->cashier, $this->device, [[
            'operation_id' => (string) Str::uuid7(),
            'entity' => 'orders',
            'action' => 'upsert',
            'record_id' => (string) Str::uuid7(),
            'payload' => [
                'order_number' => 'OM-'.Str::random(6),
                'status' => 'completed',
                'subtotal' => '20.00', 'tax' => '0.00', 'discount' => '0.00', 'total' => '20.00',
                'amount_paid' => '20.00', 'change_due' => '0.00',
                'payment_method' => $method,
                'client_created_at' => now()->toIso8601String(),
                'items' => [[
                    'id' => (string) Str::uuid7(),
                    'product_id' => $product->id,
                    'product_name' => 'Sachet water',
                    'unit_price' => '20.00', 'quantity' => 1, 'line_total' => '20.00',
                ]],
            ],
        ]]);
    }

    private function bookedMethod(): string
    {
        return Payment::where('store_id', $this->store->id)->whereNotNull('order_id')->sole()->method;
    }

    /** The one that was broken. A phone says 'momo'; the books say mobile_money. */
    public function test_a_momo_sale_from_a_phone_reaches_the_books(): void
    {
        $result = $this->sale('momo');

        $this->assertSame(1, $result['applied'], $result['results'][0]['reason'] ?? 'push rejected');
        $this->assertSame('mobile_money', $this->bookedMethod());
    }

    /**
     * Filed under mobile money, not 'other' — which reporting shows as an
     * unidentified tender and drawer reconciliation ignores outright. A shop
     * taking most of its money by MoMo would find nearly all of it in there.
     */
    public function test_it_is_not_quietly_filed_as_an_unknown_tender(): void
    {
        $this->sale('momo');

        $this->assertNotSame('other', $this->bookedMethod());
    }

    /**
     * A method nothing recognises still books the sale. The customer paid and
     * walked out with the goods; refusing the order over its label would lose a
     * sale that happened, which is worse than recording it imprecisely.
     */
    public function test_an_unrecognised_method_still_books_the_sale(): void
    {
        $result = $this->sale('crypto');

        $this->assertSame(1, $result['applied'], $result['results'][0]['reason'] ?? 'push rejected');
        $this->assertSame('other', $this->bookedMethod());
    }

    public function test_the_ordinary_methods_are_untouched(): void
    {
        $this->sale('cash');

        $this->assertSame('cash', $this->bookedMethod());
    }

    /**
     * A settlement is typed deliberately, so an unrecognised method is worth
     * telling the cashier about rather than absorbing. The alias still works.
     */
    public function test_a_settlement_accepts_the_alias_and_refuses_nonsense(): void
    {
        $customer = Customer::create([
            'id' => (string) Str::uuid7(), 'store_id' => $this->store->id, 'name' => 'Ama Mensah',
        ]);

        $push = fn (string $method) => app(SyncService::class)->push(
            $this->store->id, $this->cashier, $this->device, [[
                'operation_id' => (string) Str::uuid7(),
                'entity' => 'payments',
                'action' => 'upsert',
                'record_id' => (string) Str::uuid7(),
                'payload' => ['customer_id' => $customer->id, 'method' => $method, 'amount' => 10],
            ]]
        );

        $accepted = $push('momo');
        $this->assertSame(1, $accepted['applied'], $accepted['results'][0]['reason'] ?? '');
        $this->assertSame('mobile_money', Payment::where('customer_id', $customer->id)->sole()->method);

        $refused = $push('crypto');
        $this->assertSame(0, $refused['applied']);
        $this->assertStringContainsString('crypto', $refused['results'][0]['reason']);
    }

    /** @return array<string, array{string, ?string}> */
    public static function methods(): array
    {
        return [
            'the picker value' => ['momo', 'mobile_money'],
            'spelled out' => ['Mobile Money', 'mobile_money'],
            'padded and shouted' => ['  CASH  ', 'cash'],
            'a bank transfer' => ['bank_transfer', 'transfer'],
            'already canonical' => ['store_credit', 'store_credit'],
            'nothing at all' => ['', null],
            'genuinely unknown' => ['crypto', null],
        ];
    }

    #[DataProvider('methods')]
    public function test_the_normaliser_maps_what_a_till_may_send(string $input, ?string $expected): void
    {
        $this->assertSame($expected, Payment::canonicalMethod($input));
    }
}

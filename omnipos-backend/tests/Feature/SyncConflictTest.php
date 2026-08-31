<?php

namespace Tests\Feature;

use App\Models\Order;
use App\Models\Store;
use App\Models\StoreMember;
use App\Models\SyncConflict;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Settling a conflict is a decision about money that has already changed hands,
 * so it is a manager's call and it has to be recorded.
 */
class SyncConflictTest extends TestCase
{
    use DatabaseTransactions;

    private Store $store;
    private User $manager;
    private User $cashier;

    protected function setUp(): void
    {
        parent::setUp();

        $this->manager = $this->makeUser();
        $this->cashier = $this->makeUser();
        $this->store = Store::create(['name' => 'S', 'owner_user_id' => $this->manager->id]);

        StoreMember::create([
            'store_id' => $this->store->id, 'user_id' => $this->manager->id, 'role' => StoreMember::ROLE_MANAGER,
        ]);
        StoreMember::create([
            'store_id' => $this->store->id, 'user_id' => $this->cashier->id, 'role' => StoreMember::ROLE_CASHIER,
        ]);
    }

    private function makeUser(): User
    {
        return User::create([
            'name' => 'U', 'email' => Str::uuid7().'@test', 'password' => Hash::make('password'),
        ]);
    }

    private function as(User $user)
    {
        return $this->actingAs($user)->withHeaders(['X-Store-Id' => $this->store->id]);
    }

    private function makeConflict(string $operationId): SyncConflict
    {
        return SyncConflict::create([
            'operation_id' => $operationId,
            'store_id' => $this->store->id,
            'entity' => 'orders',
            'record_id' => (string) Str::uuid7(),
            'reason' => 'Order number [OM-1] already exists in this store.',
            'client_payload' => ['order_number' => 'OM-1', 'total' => '20.00'],
            'server_state' => ['order_number' => 'OM-1', 'total' => '28.00'],
        ]);
    }

    public function test_a_manager_sees_pending_conflicts_with_both_sides(): void
    {
        $this->makeConflict((string) Str::uuid7());

        $this->as($this->manager)->getJson('/api/sync/conflicts')
            ->assertOk()
            ->assertJsonPath('pending_count', 1)
            // Both sides are needed, or there is nothing to compare.
            ->assertJsonPath('data.0.client_payload.total', '20.00')
            ->assertJsonPath('data.0.server_state.total', '28.00')
            ->assertJsonPath('data.0.resolution', 'pending');
    }

    public function test_a_cashier_cannot_see_or_settle_conflicts(): void
    {
        $conflict = $this->makeConflict((string) Str::uuid7());

        $this->as($this->cashier)->getJson('/api/sync/conflicts')->assertForbidden();

        $this->as($this->cashier)
            ->postJson("/api/sync/conflicts/{$conflict->operation_id}/resolve", ['action' => 'acknowledge'])
            ->assertForbidden();
    }

    /**
     * Addressed by operation_id, not the conflict row's id: that is the only
     * identifier the client also holds.
     */
    public function test_a_conflict_is_settled_by_operation_id_and_audited(): void
    {
        $operationId = (string) Str::uuid7();
        $conflict = $this->makeConflict($operationId);

        $this->as($this->manager)
            ->postJson("/api/sync/conflicts/{$operationId}/resolve", [
                'action' => 'acknowledge',
                'note' => 'The till re-pushed this itself.',
            ])
            ->assertOk()
            ->assertJsonPath('resolution', 'client_wins');

        $this->assertSame('client_wins', $conflict->refresh()->resolution);
        $this->assertSame($this->manager->id, $conflict->resolved_by_user_id);
        $this->assertNotNull($conflict->resolved_at);

        $this->assertDatabaseHas('audit_logs', [
            'action' => 'sync.conflict_resolved',
            'entity_id' => $conflict->record_id,
            'user_id' => $this->manager->id,
        ]);
    }

    /**
     * Two managers on two devices can reach the same conflict. The second must
     * be told it is already settled rather than silently overwriting the first
     * one's decision about a sale.
     */
    public function test_settling_the_same_conflict_twice_is_refused(): void
    {
        $operationId = (string) Str::uuid7();
        $this->makeConflict($operationId);

        $this->as($this->manager)
            ->postJson("/api/sync/conflicts/{$operationId}/resolve", ['action' => 'acknowledge'])
            ->assertOk();

        $this->as($this->manager)
            ->postJson("/api/sync/conflicts/{$operationId}/resolve", ['action' => 'discard'])
            ->assertStatus(409)
            ->assertJsonPath('resolution', 'client_wins');
    }

    public function test_a_conflict_from_another_store_is_not_reachable(): void
    {
        $outsider = $this->makeUser();
        $otherStore = Store::create(['name' => 'Other', 'owner_user_id' => $outsider->id]);

        $operationId = (string) Str::uuid7();
        SyncConflict::create([
            'operation_id' => $operationId,
            'store_id' => $otherStore->id,
            'entity' => 'orders',
            'record_id' => (string) Str::uuid7(),
            'reason' => 'x',
        ]);

        $this->as($this->manager)
            ->postJson("/api/sync/conflicts/{$operationId}/resolve", ['action' => 'acknowledge'])
            ->assertNotFound();
    }

    /**
     * The point of remote resolution.
     *
     * The sale was rung up on another till, which is offline or in someone
     * else's hands. The manager never had it, so the corrected data cannot come
     * from their device — it comes from the payload the server kept when the
     * push was rejected, booked under a number the server knows is free.
     */
    public function test_a_manager_books_another_tills_sale_from_the_stored_payload(): void
    {
        $prefix = 'OM-'.now()->format('Ymd').'-';

        // The sale the other till already had accepted.
        Order::create([
            'store_id' => $this->store->id,
            'cashier_user_id' => $this->cashier->id,
            'order_number' => $prefix.'0001',
            'status' => 'completed',
            'subtotal' => 28, 'total' => 28, 'amount_paid' => 28,
            'client_created_at' => now(),
        ]);

        $recordId = (string) Str::uuid7();
        $operationId = (string) Str::uuid7();

        SyncConflict::create([
            'operation_id' => $operationId,
            'store_id' => $this->store->id,
            'entity' => 'orders',
            'record_id' => $recordId,
            'reason' => "Order number [{$prefix}0001] already exists in this store.",
            'client_payload' => [
                'id' => $recordId,
                'order_number' => $prefix.'0001',
                'status' => 'completed',
                'subtotal' => '15.00', 'tax' => '0.00', 'discount' => '0.00', 'total' => '15.00',
                'amount_paid' => '15.00', 'change_due' => '0.00', 'payment_method' => 'cash',
                'client_created_at' => now()->toIso8601String(),
                'items' => [],
                'payments' => [['method' => 'cash', 'amount' => '15.00']],
            ],
        ]);

        $response = $this->as($this->manager)
            ->postJson("/api/sync/conflicts/{$operationId}/resolve", ['action' => 'reissue'])
            ->assertOk()
            ->assertJsonPath('resolution', 'merged');

        $bookedAs = $response->json('booked_as');
        $this->assertSame($prefix.'0002', $bookedAs, 'must take the next free number, not the clashing one');

        // The sale is now on the books under its original record id.
        $this->assertDatabaseHas('orders', [
            'id' => $recordId, 'order_number' => $bookedAs, 'total' => '15.00',
        ]);

        // The other till's sale is untouched.
        $this->assertDatabaseHas('orders', ['order_number' => $prefix.'0001', 'total' => '28.00']);

        // Payments came across, so the takings are right.
        $this->assertDatabaseHas('payments', ['order_id' => $recordId, 'amount' => '15.00']);

        // Published to the changefeed with no origin device, so EVERY till
        // receives it — including the one that raised the conflict, which is how
        // it learns to clear its queue.
        $this->assertDatabaseHas('sync_changes', [
            'record_id' => $recordId, 'entity' => 'orders', 'origin_device_id' => null,
        ]);
    }

    /**
     * If the re-issue itself cannot be applied, the conflict must stay pending.
     * Marking it settled when nothing was booked would hide the money.
     */
    public function test_a_failed_reissue_leaves_the_conflict_pending(): void
    {
        $operationId = (string) Str::uuid7();
        $conflict = SyncConflict::create([
            'operation_id' => $operationId,
            'store_id' => $this->store->id,
            'entity' => 'orders',
            'record_id' => (string) Str::uuid7(),
            'reason' => 'x',
            'client_payload' => null,
        ]);

        $this->as($this->manager)
            ->postJson("/api/sync/conflicts/{$operationId}/resolve", ['action' => 'reissue'])
            ->assertStatus(422);

        $this->assertSame('pending', $conflict->refresh()->resolution);
    }

    public function test_discarding_books_nothing(): void
    {
        $operationId = (string) Str::uuid7();
        $conflict = $this->makeConflict($operationId);

        $before = Order::count();

        $this->as($this->manager)
            ->postJson("/api/sync/conflicts/{$operationId}/resolve", ['action' => 'discard'])
            ->assertOk()
            ->assertJsonPath('resolution', 'server_wins')
            ->assertJsonPath('booked_as', null);

        $this->assertSame($before, Order::count());
        $this->assertSame('server_wins', $conflict->refresh()->resolution);
    }

    public function test_an_unknown_action_is_rejected(): void
    {
        $operationId = (string) Str::uuid7();
        $this->makeConflict($operationId);

        $this->as($this->manager)
            ->postJson("/api/sync/conflicts/{$operationId}/resolve", ['action' => 'whatever'])
            ->assertStatus(422);
    }
}

<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\Store;
use App\Models\StoreMember;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Provisioning replaces an Edge Function that held a service-role key and so
 * bypassed row-level security completely. The only thing that ever stopped an
 * ordinary user from creating stores and accounts was a hand-written
 * is_super_admin check, and these tests exist because that check is now the
 * whole boundary.
 */
class SuperAdminTest extends TestCase
{
    use DatabaseTransactions;

    private User $platformAdmin;
    private User $ordinary;

    protected function setUp(): void
    {
        parent::setUp();

        $this->platformAdmin = $this->makeUser(superAdmin: true);
        $this->ordinary = $this->makeUser();
    }

    private function makeUser(bool $superAdmin = false): User
    {
        return User::create([
            'name' => 'U',
            'email' => Str::uuid7().'@test',
            'password' => Hash::make('password'),
            'is_super_admin' => $superAdmin,
        ]);
    }

    private function as(User $user)
    {
        return $this->actingAs($user)->withHeaders(['Accept' => 'application/json']);
    }

    private function payload(array $overrides = []): array
    {
        return array_merge([
            'store_name' => 'Harbour Road Branch',
            'currency' => 'GHS',
            'timezone' => 'Africa/Accra',
            'admin_email' => Str::uuid7().'@test',
            'admin_name' => 'Ama Mensah',
            'admin_password' => 'correct-horse',
        ], $overrides);
    }

    public function test_an_ordinary_user_cannot_list_every_store_on_the_platform(): void
    {
        $this->as($this->ordinary)->getJson('/api/admin/stores')->assertForbidden();
    }

    /**
     * The dangerous one. Without the guard, any authenticated cashier could mint
     * a user account and a tenant to put it in.
     */
    public function test_an_ordinary_user_cannot_provision_a_store(): void
    {
        $this->as($this->ordinary)->postJson('/api/admin/stores', $this->payload())->assertForbidden();

        $this->assertDatabaseMissing('stores', ['name' => 'Harbour Road Branch']);
    }

    public function test_an_anonymous_caller_is_rejected(): void
    {
        $this->postJson('/api/admin/stores', $this->payload())->assertUnauthorized();
    }

    public function test_a_platform_admin_sees_stores_they_are_not_a_member_of(): void
    {
        $owner = $this->makeUser();
        $store = Store::create(['name' => 'Someone Elses Shop', 'owner_user_id' => $owner->id]);
        StoreMember::create([
            'store_id' => $store->id, 'user_id' => $owner->id, 'role' => StoreMember::ROLE_ADMIN,
        ]);

        $response = $this->as($this->platformAdmin)->getJson('/api/admin/stores')->assertOk();

        $row = collect($response->json('data'))->firstWhere('id', $store->id);

        $this->assertNotNull($row, 'A platform admin must see stores across tenants, not only their own.');
        $this->assertSame($owner->email, $row['owner']['email']);
        $this->assertSame(1, $row['members_count']);
    }

    public function test_provisioning_creates_the_store_the_admin_account_and_the_membership_together(): void
    {
        $email = Str::uuid7().'@test';

        $response = $this->as($this->platformAdmin)
            ->postJson('/api/admin/stores', $this->payload(['admin_email' => $email]))
            ->assertCreated();

        $storeId = $response->json('store.id');
        $adminId = $response->json('admin.id');

        $this->assertTrue($response->json('account_created'));
        $this->assertSame('GHS', $response->json('store.currency'));

        // A store whose admin was not created, or was created without a
        // membership, is a store nobody can open — the failure this endpoint
        // exists to make impossible.
        $this->assertDatabaseHas('users', ['id' => $adminId, 'email' => $email, 'name' => 'Ama Mensah']);
        $this->assertDatabaseHas('stores', ['id' => $storeId, 'owner_user_id' => $adminId]);
        $this->assertDatabaseHas('store_members', [
            'store_id' => $storeId, 'user_id' => $adminId, 'role' => StoreMember::ROLE_ADMIN,
        ]);
    }

    /** The new admin must be able to actually sign in with what they were handed. */
    public function test_the_provisioned_admin_can_authenticate_with_the_issued_password(): void
    {
        $email = Str::uuid7().'@test';

        $this->as($this->platformAdmin)
            ->postJson('/api/admin/stores', $this->payload(['admin_email' => $email, 'admin_password' => 'letmein-please']))
            ->assertCreated();

        $user = User::where('email', $email)->firstOrFail();

        $this->assertTrue(Hash::check('letmein-please', $user->password));
    }

    /**
     * A second store for someone who already has a login must attach to that
     * login, not fail and not create a duplicate account they cannot use.
     */
    public function test_an_existing_user_is_reused_rather_than_duplicated(): void
    {
        $existing = $this->makeUser();

        $response = $this->as($this->platformAdmin)
            ->postJson('/api/admin/stores', $this->payload([
                'store_name' => 'Second Branch',
                'admin_email' => Str::upper($existing->email),
                'admin_password' => null,
            ]))
            ->assertCreated();

        $this->assertFalse($response->json('account_created'));
        $this->assertSame($existing->id, $response->json('admin.id'));
        $this->assertSame(1, User::where('email', $existing->email)->count());
        $this->assertDatabaseHas('store_members', [
            'store_id' => $response->json('store.id'), 'user_id' => $existing->id,
        ]);
    }

    /** Silently inventing one would hand out a credential nobody could reproduce. */
    public function test_a_new_account_without_a_password_is_refused(): void
    {
        $this->as($this->platformAdmin)
            ->postJson('/api/admin/stores', $this->payload(['admin_password' => null]))
            ->assertStatus(422);

        $this->assertDatabaseMissing('stores', ['name' => 'Harbour Road Branch']);
    }

    public function test_a_failed_provision_leaves_no_orphaned_user(): void
    {
        $email = Str::uuid7().'@test';

        // A parent store id that does not exist fails validation before the
        // transaction opens; assert the user was not created on the way past.
        $this->as($this->platformAdmin)
            ->postJson('/api/admin/stores', $this->payload([
                'admin_email' => $email,
                'parent_store_id' => (string) Str::uuid7(),
            ]))
            ->assertStatus(422);

        $this->assertDatabaseMissing('users', ['email' => $email]);
    }

    public function test_provisioning_is_recorded_in_the_audit_log(): void
    {
        $response = $this->as($this->platformAdmin)
            ->postJson('/api/admin/stores', $this->payload())
            ->assertCreated();

        $entry = AuditLog::where('store_id', $response->json('store.id'))
            ->where('action', 'platform.store_provisioned')
            ->first();

        $this->assertNotNull($entry, 'Creating a tenant is exactly the kind of act that must be attributable.');
        $this->assertSame($this->platformAdmin->id, $entry->user_id);
    }
}

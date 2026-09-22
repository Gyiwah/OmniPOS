<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\Plan;
use App\Models\GlobalCategory;
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

    public function test_platform_dashboard_is_global_and_not_available_to_store_users(): void
    {
        $owner = $this->makeUser();
        $store = Store::create(['name' => 'Dashboard Store', 'owner_user_id' => $owner->id]);
        StoreMember::create(['store_id' => $store->id, 'user_id' => $owner->id, 'role' => StoreMember::ROLE_ADMIN]);

        $this->as($this->ordinary)->getJson('/api/admin/dashboard')->assertForbidden();

        $response = $this->as($this->platformAdmin)->getJson('/api/admin/dashboard')->assertOk();
        $this->assertGreaterThanOrEqual(1, $response->json('stores.total'));
        $this->assertGreaterThanOrEqual(1, $response->json('users.total'));
        $this->assertArrayHasKey('sync', $response->json());
    }

    public function test_platform_admin_can_view_store_members_without_operational_access(): void
    {
        $owner = $this->makeUser();
        $store = Store::create(['name' => 'Member Store', 'owner_user_id' => $owner->id]);
        StoreMember::create(['store_id' => $store->id, 'user_id' => $owner->id, 'role' => StoreMember::ROLE_ADMIN]);

        $response = $this->as($this->platformAdmin)->getJson("/api/admin/stores/{$store->id}/members")->assertOk();

        $this->assertSame($owner->email, $response->json('data.0.user.email'));
        $this->assertSame(StoreMember::ROLE_ADMIN, $response->json('data.0.role'));
    }

    public function test_platform_admin_can_list_branches_with_their_parent_store(): void
    {
        $parent = Store::create(['name' => 'Main Store', 'owner_user_id' => $this->makeUser()->id]);
        $branch = Store::create(['name' => 'Downtown Branch', 'owner_user_id' => $this->makeUser()->id, 'parent_store_id' => $parent->id]);

        $response = $this->as($this->platformAdmin)->getJson('/api/admin/branches')->assertOk();

        $row = collect($response->json('data'))->firstWhere('id', $branch->id);
        $this->assertNotNull($row);
        $this->assertSame($parent->id, $row['parent_store']['id']);
        $this->assertSame('Downtown Branch', $row['name']);
    }

    public function test_platform_admin_can_change_store_platform_status_and_it_is_audited(): void
    {
        $owner = $this->makeUser();
        $store = Store::create(['name' => 'Status Store', 'owner_user_id' => $owner->id]);

        $this->as($this->ordinary)
            ->patchJson("/api/admin/stores/{$store->id}/status", ['status' => 'suspended'])
            ->assertForbidden();

        $this->as($this->platformAdmin)
            ->patchJson("/api/admin/stores/{$store->id}/status", ['status' => 'suspended'])
            ->assertOk()
            ->assertJsonPath('store.platform_status', 'suspended');

        $this->assertDatabaseHas('stores', ['id' => $store->id, 'platform_status' => 'suspended']);
        $this->assertDatabaseHas('audit_logs', ['store_id' => $store->id, 'action' => 'platform.store_status_changed']);
    }

    public function test_platform_admin_can_manage_people_roles_and_platform_admin_access(): void
    {
        $owner = $this->makeUser();
        $store = Store::create(['name' => 'People Store', 'owner_user_id' => $owner->id]);
        StoreMember::create(['store_id' => $store->id, 'user_id' => $owner->id, 'role' => StoreMember::ROLE_ADMIN]);

        $response = $this->as($this->platformAdmin)
            ->getJson('/api/admin/people')
            ->assertOk();

        $this->assertNotNull(collect($response->json('data'))->firstWhere('email', $owner->email));

        $this->as($this->platformAdmin)
            ->patchJson("/api/admin/people/{$owner->id}/stores/{$store->id}", ['role' => StoreMember::ROLE_MANAGER])
            ->assertOk();

        $this->assertDatabaseHas('store_members', ['store_id' => $store->id, 'user_id' => $owner->id, 'role' => StoreMember::ROLE_MANAGER]);

        $this->as($this->platformAdmin)
            ->patchJson("/api/admin/people/{$owner->id}/platform-admin", ['is_super_admin' => true])
            ->assertOk();

        $this->assertDatabaseHas('users', ['id' => $owner->id, 'is_super_admin' => true]);
    }

    public function test_platform_admin_can_create_update_and_delete_people(): void
    {
        $store = Store::create(['name' => 'Staff Store', 'owner_user_id' => $this->platformAdmin->id]);
        $email = Str::uuid7().'@test';

        $this->as($this->ordinary)
            ->postJson('/api/admin/people', ['name' => 'Kofi', 'email' => $email, 'password' => 'password12'])
            ->assertForbidden();

        $created = $this->as($this->platformAdmin)
            ->postJson('/api/admin/people', [
                'name' => 'Kofi Mensah',
                'email' => $email,
                'password' => 'password12',
                'store_id' => $store->id,
                'role' => StoreMember::ROLE_CASHIER,
            ])
            ->assertCreated()
            ->json('person');

        $this->assertDatabaseHas('users', ['id' => $created['id'], 'name' => 'Kofi Mensah', 'email' => $email]);
        $this->assertDatabaseHas('store_members', ['store_id' => $store->id, 'user_id' => $created['id'], 'role' => StoreMember::ROLE_CASHIER]);

        $this->as($this->platformAdmin)
            ->patchJson("/api/admin/people/{$created['id']}", ['name' => 'Kofi Boateng', 'role' => StoreMember::ROLE_MANAGER, 'store_id' => $store->id])
            ->assertOk()
            ->assertJsonPath('person.name', 'Kofi Boateng');

        $this->assertDatabaseHas('store_members', ['store_id' => $store->id, 'user_id' => $created['id'], 'role' => StoreMember::ROLE_MANAGER]);

        $this->as($this->platformAdmin)
            ->deleteJson("/api/admin/people/{$created['id']}")
            ->assertOk();

        $this->assertSoftDeleted('users', ['id' => $created['id']]);

        $this->as($this->platformAdmin)
            ->deleteJson("/api/admin/people/{$this->platformAdmin->id}")
            ->assertStatus(422);
    }

    public function test_platform_admin_can_manage_store_and_branch_crud(): void
    {
        $owner = $this->makeUser();
        $store = Store::create(['name' => 'Head Office', 'owner_user_id' => $owner->id, 'platform_status' => 'active']);

        $this->as($this->platformAdmin)
            ->patchJson("/api/admin/stores/{$store->id}", ['name' => 'Main Headquarters', 'currency' => 'USD'])
            ->assertOk()
            ->assertJsonPath('store.name', 'Main Headquarters');

        $this->as($this->platformAdmin)
            ->postJson('/api/admin/branches', ['name' => 'Downtown Branch', 'parent_store_id' => $store->id, 'owner_user_id' => $owner->id, 'currency' => 'USD'])
            ->assertCreated();

        $this->as($this->platformAdmin)
            ->postJson('/api/admin/branches', ['name' => 'North Branch', 'parent_store_id' => $store->id, 'currency' => 'GHS'])
            ->assertCreated()
            ->assertJsonPath('branch.owner_user_id', $owner->id);

        $branch = Store::where('name', 'Downtown Branch')->firstOrFail();

        $this->as($this->platformAdmin)
            ->patchJson("/api/admin/branches/{$branch->id}", ['name' => 'Central Branch', 'platform_status' => 'suspended'])
            ->assertOk()
            ->assertJsonPath('branch.name', 'Central Branch');

        $this->as($this->platformAdmin)
            ->deleteJson("/api/admin/branches/{$branch->id}")
            ->assertOk();

        $this->as($this->platformAdmin)
            ->deleteJson("/api/admin/stores/{$store->id}")
            ->assertOk();

        $this->assertDatabaseHas('stores', ['id' => $store->id, 'name' => 'Main Headquarters']);
        $this->assertSoftDeleted('stores', ['id' => $store->id]);
        $this->assertSoftDeleted('stores', ['id' => $branch->id]);
    }

    public function test_platform_admin_can_create_a_plan_and_assign_it_to_a_store(): void
    {
        $slug = 'starter-' . Str::random(6);
        $planResponse = $this->as($this->ordinary)
            ->postJson('/api/admin/plans', ['name' => 'Starter', 'slug' => $slug, 'monthly_price' => 49, 'limits' => ['users' => 5]])
            ->assertForbidden();

        $planResponse = $this->as($this->platformAdmin)
            ->postJson('/api/admin/plans', ['name' => 'Starter', 'slug' => $slug, 'monthly_price' => 49, 'limits' => ['users' => 5]])
            ->assertCreated();

        $owner = $this->makeUser();
        $store = Store::create(['name' => 'Subscription Store', 'owner_user_id' => $owner->id]);
        $plan = Plan::findOrFail($planResponse->json('plan.id'));

        $this->as($this->platformAdmin)
            ->postJson("/api/admin/stores/{$store->id}/subscription", ['plan_id' => $plan->id])
            ->assertOk()
            ->assertJsonPath('subscription.plan_id', $plan->id);

        $this->assertDatabaseHas('subscriptions', ['store_id' => $store->id, 'plan_id' => $plan->id, 'status' => 'active']);
        $this->assertDatabaseHas('audit_logs', ['store_id' => $store->id, 'action' => 'platform.subscription_changed']);
    }

    public function test_platform_admin_can_manage_global_resources_but_store_users_cannot(): void
    {
        $slug = 'beverages-' . Str::random(6);
        $this->as($this->ordinary)
            ->postJson('/api/admin/system-resources/categories', ['name' => 'Beverages', 'slug' => $slug])
            ->assertForbidden();

        $this->as($this->platformAdmin)
            ->postJson('/api/admin/system-resources/categories', ['name' => 'Beverages', 'slug' => $slug])
            ->assertCreated();

        $this->as($this->platformAdmin)
            ->patchJson('/api/admin/system-resources/settings/platform.maintenance', ['value' => ['enabled' => true], 'description' => 'Maintenance mode'])
            ->assertOk()
            ->assertJsonPath('setting.value.enabled', true);

        $this->assertDatabaseHas('global_categories', ['slug' => $slug, 'status' => 'active']);
        $this->assertDatabaseHas('audit_logs', ['action' => 'platform.global_category_created']);
        $this->assertDatabaseHas('audit_logs', ['action' => 'platform.system_setting_changed']);
    }

    public function test_platform_admin_can_update_and_delete_platform_plan_and_category_entries(): void
    {
        $planSlug = 'starter-' . Str::random(6);
        $catSlug = 'beverages-' . Str::random(6);
        $plan = Plan::create(['name' => 'Starter', 'slug' => $planSlug, 'monthly_price' => 49, 'platform_status' => 'active']);
        $category = GlobalCategory::create(['name' => 'Beverages', 'slug' => $catSlug, 'status' => 'active', 'position' => 1]);

        $this->as($this->platformAdmin)
            ->patchJson("/api/admin/plans/{$plan->id}", ['name' => 'Starter Plus', 'monthly_price' => 59])
            ->assertOk()
            ->assertJsonPath('plan.name', 'Starter Plus');

        $this->as($this->platformAdmin)
            ->deleteJson("/api/admin/plans/{$plan->id}")
            ->assertOk();

        $this->as($this->platformAdmin)
            ->patchJson("/api/admin/system-resources/categories/{$category->id}", ['name' => 'Drinks'])
            ->assertOk()
            ->assertJsonPath('category.name', 'Drinks');

        $this->as($this->platformAdmin)
            ->deleteJson("/api/admin/system-resources/categories/{$category->id}")
            ->assertOk();

        $this->assertDatabaseHas('plans', ['id' => $plan->id, 'platform_status' => 'archived']);
        $this->assertDatabaseMissing('global_categories', ['id' => $category->id]);
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

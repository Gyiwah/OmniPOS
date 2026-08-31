<?php

namespace Tests\Feature;

use App\Models\Store;
use App\Models\StoreMember;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * EnsureStoreAccess is what replaced Supabase RLS. Under RLS a query that forgot
 * to filter by store still returned nothing it should not; there is no such
 * backstop now, so this middleware is the entire tenancy boundary and needs to be
 * exercised over HTTP rather than trusted.
 */
class StoreAccessTest extends TestCase
{
    use DatabaseTransactions;

    private function user(string $email): User
    {
        return User::create([
            'name' => 'U',
            'email' => $email.'-'.Str::uuid7().'@test',
            'password' => Hash::make('password'),
        ]);
    }

    private function storeOwnedBy(User $owner): Store
    {
        return Store::create(['name' => 'S', 'owner_user_id' => $owner->id]);
    }

    /**
     * Regression: logout used to fatal for cookie-session users.
     *
     * currentAccessToken() returns a TransientToken (not null) for a SPA
     * session. Testing it for truthiness and calling delete() on it threw
     * "Call to undefined method TransientToken::delete()", so every web sign-out
     * returned a 500. Because the client signs out locally regardless, the
     * cashier appeared signed out while the server session stayed live — on a
     * shared till, the opposite of what sign-out must mean.
     */
    public function test_a_web_session_user_can_sign_out(): void
    {
        $user = $this->user('signout');

        $this->actingAs($user)
            ->postJson('/api/auth/logout')
            ->assertOk()
            ->assertJsonPath('message', 'Signed out.');
    }

    public function test_a_token_user_signing_out_revokes_only_that_token(): void
    {
        $user = $this->user('tokens');

        $keep = $user->createToken('other-till');
        $use = $user->createToken('this-till');

        $this->withHeader('Authorization', 'Bearer '.$use->plainTextToken)
            ->postJson('/api/auth/logout')
            ->assertOk();

        $this->assertDatabaseMissing('personal_access_tokens', ['id' => $use->accessToken->id]);
        $this->assertDatabaseHas('personal_access_tokens', ['id' => $keep->accessToken->id]);
    }

    public function test_unauthenticated_requests_are_rejected(): void
    {
        $this->postJson('/api/sync/push', ['operations' => []])->assertUnauthorized();
    }

    public function test_a_member_can_reach_their_own_store(): void
    {
        $user = $this->user('member');
        $store = $this->storeOwnedBy($user);
        StoreMember::create([
            'store_id' => $store->id, 'user_id' => $user->id, 'role' => StoreMember::ROLE_CASHIER,
        ]);

        $this->actingAs($user)
            ->postJson('/api/sync/devices', [
                'device_id' => (string) Str::uuid7(),
                'platform' => 'test',
            ], ['X-Store-Id' => $store->id])
            ->assertOk()
            ->assertJsonPath('device.store_id', $store->id);
    }

    public function test_a_non_member_gets_404_not_403_so_the_tenant_list_does_not_leak(): void
    {
        $owner = $this->user('owner');
        $store = $this->storeOwnedBy($owner);
        StoreMember::create([
            'store_id' => $store->id, 'user_id' => $owner->id, 'role' => StoreMember::ROLE_ADMIN,
        ]);

        $outsider = $this->user('outsider');

        // 403 would confirm the store exists. 404 does not distinguish
        // "not yours" from "not real".
        $this->actingAs($outsider)
            ->postJson('/api/sync/devices', [
                'device_id' => (string) Str::uuid7(),
                'platform' => 'test',
            ], ['X-Store-Id' => $store->id])
            ->assertNotFound();
    }

    public function test_a_request_without_a_store_context_is_rejected(): void
    {
        $user = $this->user('nostore');

        $this->actingAs($user)
            ->postJson('/api/sync/devices', [
                'device_id' => (string) Str::uuid7(),
                'platform' => 'test',
            ])
            ->assertStatus(400);
    }

    public function test_a_super_admin_reaches_a_store_they_are_not_a_member_of(): void
    {
        $owner = $this->user('owner2');
        $store = $this->storeOwnedBy($owner);

        $super = $this->user('super');
        $super->forceFill(['is_super_admin' => true])->save();

        $this->actingAs($super)
            ->postJson('/api/sync/devices', [
                'device_id' => (string) Str::uuid7(),
                'platform' => 'test',
            ], ['X-Store-Id' => $store->id])
            ->assertOk();
    }

    public function test_token_login_issues_a_bearer_token_and_reports_memberships(): void
    {
        $user = $this->user('tok');
        $store = $this->storeOwnedBy($user);
        StoreMember::create([
            'store_id' => $store->id, 'user_id' => $user->id, 'role' => StoreMember::ROLE_MANAGER,
        ]);

        $response = $this->postJson('/api/auth/token', [
            'email' => $user->email,
            'password' => 'password',
            'device_name' => 'till-1',
        ])->assertOk();

        $this->assertNotEmpty($response->json('token'));
        $response->assertJsonPath('memberships.0.role', 'manager');
        $response->assertJsonPath('memberships.0.store_id', $store->id);
    }

    public function test_bad_credentials_do_not_reveal_whether_the_email_exists(): void
    {
        $user = $this->user('real');

        $known = $this->postJson('/api/auth/token', [
            'email' => $user->email, 'password' => 'wrong', 'device_name' => 'd',
        ])->assertStatus(422);

        $unknown = $this->postJson('/api/auth/token', [
            'email' => 'nobody-'.Str::uuid7().'@test', 'password' => 'wrong', 'device_name' => 'd',
        ])->assertStatus(422);

        $this->assertSame(
            $known->json('errors.email'),
            $unknown->json('errors.email'),
            'the two responses must be indistinguishable'
        );
    }
}

<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Signing in from a host Sanctum does not treat as the SPA.
 *
 * /api/auth/login is the cookie-session route. Sanctum decides whether to start
 * a session by matching the request's Origin or Referer against
 * SANCTUM_STATEFUL_DOMAINS, and when the deployed frontend is not in that list
 * no session exists — so `$request->session()->regenerate()` threw a
 * RuntimeException, which reaches the caller as a bare 500.
 *
 * That list not naming the real frontend domain is the first thing to go wrong
 * on a deploy to a real host. A 500 gives whoever is debugging it nothing at
 * all: not which setting, not which value. It is also the wrong status, since
 * nothing on the server is broken.
 */
class StatelessLoginTest extends TestCase
{
    use DatabaseTransactions;

    private function user(): User
    {
        return User::create([
            'name' => 'Till Cashier',
            'email' => 'cashier-'.Str::uuid7().'@test',
            'password' => Hash::make('correct-horse'),
        ]);
    }

    public function test_a_host_without_a_session_gets_an_actionable_error_not_a_500(): void
    {
        $user = $this->user();

        $response = $this->postJson('/api/auth/login', [
            'email' => $user->email,
            'password' => 'correct-horse',
        ]);

        $response->assertStatus(419);
        $this->assertStringContainsString('SANCTUM_STATEFUL_DOMAINS', $response->json('message'));

        // Echoed back because it is the value that has to go in that list, and
        // guessing it is most of the work of fixing this.
        $this->assertSame(request()->getHttpHost(), $response->json('host'));
        $this->assertNotEmpty($response->json('host'));
    }

    /**
     * The message has to name the other door as well. A mobile client pointed
     * at the wrong endpoint would otherwise be told to edit server config it
     * has no business touching.
     */
    public function test_the_error_points_at_the_token_endpoint(): void
    {
        $user = $this->user();

        $response = $this->postJson('/api/auth/login', [
            'email' => $user->email,
            'password' => 'correct-horse',
        ]);

        $this->assertStringContainsString('/api/auth/token', $response->json('message'));
    }

    /**
     * Wrong credentials must still fail as wrong credentials. Reporting the
     * session problem first would tell an attacker their guess was right.
     */
    public function test_bad_credentials_are_still_rejected_before_the_session_check(): void
    {
        $user = $this->user();

        $this->postJson('/api/auth/login', [
            'email' => $user->email,
            'password' => 'wrong',
        ])->assertStatus(422);
    }

    /** The route a device actually uses is unaffected and needs no session. */
    public function test_the_token_endpoint_works_from_the_same_stateless_request(): void
    {
        $user = $this->user();

        $response = $this->postJson('/api/auth/token', [
            'email' => $user->email,
            'password' => 'correct-horse',
            'device_name' => 'till-01',
        ]);

        $response->assertOk();
        $this->assertNotEmpty($response->json('token'));
    }
}

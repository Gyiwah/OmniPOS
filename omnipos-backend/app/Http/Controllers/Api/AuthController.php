<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Services\StoreInviteService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;
use Laravel\Sanctum\PersonalAccessToken;

/**
 * Replaces Supabase GoTrue.
 *
 * Two auth modes over one user table, which is what Sanctum is for:
 *   - web SPA: cookie session (login/logout below, with statefulApi middleware)
 *   - mobile:  bearer token issued by /api/auth/token
 */
class AuthController extends Controller
{
    public function __construct(private readonly StoreInviteService $invites)
    {
    }

    /** Cookie-session login for the web client. */
    public function login(Request $request): JsonResponse
    {
        $credentials = $request->validate([
            'email' => ['required', 'email'],
            'password' => ['required', 'string'],
        ]);

        if (! Auth::attempt($credentials, $request->boolean('remember'))) {
            // One message for both unknown-email and wrong-password, so the
            // endpoint cannot be used to enumerate registered addresses.
            throw ValidationException::withMessages([
                'email' => __('These credentials do not match our records.'),
            ]);
        }

        /*
         * A cookie session only exists if Sanctum recognised this request as
         * coming from the SPA, which it decides from the Origin or Referer
         * against SANCTUM_STATEFUL_DOMAINS. When that list does not name the
         * deployed frontend — the first thing to go wrong on a real domain —
         * there is no session, and regenerate() throws a RuntimeException the
         * caller sees as a bare 500.
         *
         * A 500 says nothing. This says which setting is wrong, and names the
         * host it actually saw, which is the value that has to go in the list.
         */
        if (! $request->hasSession()) {
            return response()->json([
                'message' => 'This host is not configured for cookie sessions. '
                    .'Add it to SANCTUM_STATEFUL_DOMAINS, or authenticate at /api/auth/token instead.',
                'host' => $request->getHttpHost(),
            ], 419);
        }

        $request->session()->regenerate();

        $user = $request->user();
        $this->invites->acceptPendingFor($user);

        return response()->json($this->profilePayload($user->fresh('memberships')));
    }

    /** Bearer-token login for the mobile client. */
    public function token(Request $request): JsonResponse
    {
        $data = $request->validate([
            'email' => ['required', 'email'],
            'password' => ['required', 'string'],
            'device_name' => ['required', 'string', 'max:120'],
        ]);

        $user = User::where('email', $data['email'])->first();

        if (! $user || ! $user->password || ! Hash::check($data['password'], $user->password)) {
            throw ValidationException::withMessages([
                'email' => __('These credentials do not match our records.'),
            ]);
        }

        $this->invites->acceptPendingFor($user);

        // One active token per named device: re-authenticating on a terminal
        // revokes the token that terminal held before.
        $user->tokens()->where('name', $data['device_name'])->delete();

        $token = $user->createToken($data['device_name'])->plainTextToken;

        return response()->json([
            'token' => $token,
            ...$this->profilePayload($user->fresh('memberships')),
        ]);
    }

    public function me(Request $request): JsonResponse
    {
        return response()->json($this->profilePayload($request->user()->loadMissing('memberships.store')));
    }

    /**
     * Sign out of whichever mechanism the caller actually used.
     *
     * currentAccessToken() does NOT return null for a cookie session — it
     * returns a TransientToken, which is truthy and has no delete(). Testing it
     * for truthiness therefore fatalled on every web sign-out, and because the
     * client signs out locally regardless of the response, the cashier appeared
     * signed out while the server session stayed live. On a shared till that is
     * the opposite of what "Sign out" must mean, so the check is on the concrete
     * token type rather than on truthiness.
     */
    public function logout(Request $request): JsonResponse
    {
        $token = $request->user()?->currentAccessToken();

        if ($token instanceof PersonalAccessToken) {
            // Mobile: revoke only this device's token, leaving other tills alone.
            $token->delete();

            return response()->json(['message' => 'Signed out.']);
        }

        // Web: end the session and rotate the CSRF token.
        //
        // Guarded because the route is reachable without a session started —
        // and an endpoint whose whole job is to revoke access must not fail
        // closed on the caller. A sign-out that errors is one a cashier will
        // walk away from, believing the till is locked when it is not.
        if ($request->hasSession()) {
            Auth::guard('web')->logout();
            $request->session()->invalidate();
            $request->session()->regenerateToken();
        }

        return response()->json(['message' => 'Signed out.']);
    }

    /** @return array<string, mixed> */
    private function profilePayload(User $user): array
    {
        return [
            'user' => [
                'id' => $user->id,
                'name' => $user->name,
                'email' => $user->email,
                'avatar_url' => $user->avatar_url,
                'is_super_admin' => $user->is_super_admin,
            ],
            'memberships' => $user->memberships->map(fn ($m) => [
                'store_id' => $m->store_id,
                'role' => $m->role,
            ])->values(),
        ];
    }
}

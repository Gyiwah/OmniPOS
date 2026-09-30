<?php

namespace App\Services;

use App\Models\StoreInvite;
use App\Models\StoreMember;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Replaces the Supabase accept_pending_store_invites() plpgsql function and the
 * invite-store-member Edge Function.
 *
 * The Edge Function ran with the service-role key, which bypassed RLS entirely.
 * The authorisation it performed by hand (verify the caller is an admin or
 * manager of the store) must therefore be preserved here — this service is the
 * only thing between a signed-in user and adding themselves to any store.
 */
class StoreInviteService
{
    /**
     * Attach a user to every store that has invited their email address.
     *
     * Called on each successful sign-in, matching the mobile app's existing
     * behaviour of accepting invites at login.
     *
     * @return array<int, array{store_id: string, role: string}>
     */
    public function acceptPendingFor(User $user): array
    {
        $accepted = [];

        $invites = StoreInvite::pending()
            ->whereRaw('lower(email) = ?', [Str::lower($user->email)])
            ->get();

        foreach ($invites as $invite) {
            DB::transaction(function () use ($invite, $user, &$accepted) {
                StoreMember::updateOrCreate(
                    ['store_id' => $invite->store_id, 'user_id' => $user->id],
                    ['role' => $invite->role, 'invited_by' => $invite->invited_by],
                );

                // If this is an admin invite to a parent store, enroll as admin to all existing branches
                if ($invite->role === StoreMember::ROLE_ADMIN) {
                    $branches = \App\Models\Store::where('parent_store_id', $invite->store_id)->get();
                    foreach ($branches as $branch) {
                        StoreMember::updateOrCreate(
                            ['store_id' => $branch->id, 'user_id' => $user->id],
                            ['role' => StoreMember::ROLE_ADMIN, 'invited_by' => $invite->invited_by],
                        );
                    }
                }

                $invite->forceFill([
                    'status' => 'accepted',
                    'accepted_user_id' => $user->id,
                ])->save();

                $accepted[] = ['store_id' => $invite->store_id, 'role' => $invite->role];
            });
        }

        return $accepted;
    }

    /**
     * Create or refresh an invite. The caller must already have been authorised
     * to manage staff for this store.
     */
    public function invite(string $storeId, string $email, string $role, User $invitedBy): StoreInvite
    {
        $invite = StoreInvite::updateOrCreate(
            ['store_id' => $storeId, 'email' => Str::lower($email)],
            [
                'role' => $role,
                'status' => 'pending',
                'invited_by' => $invitedBy->id,
                'accepted_user_id' => null,
                'token' => Str::random(64),
                'expires_at' => now()->addDays(14),
            ],
        );

        // TODO: dispatch the invitation mail once a mailer is configured.
        // Deliberately not sending here — queueing that inside the request would
        // fail the invite creation if SMTP is down.

        return $invite;
    }

    public function revoke(StoreInvite $invite): void
    {
        $invite->forceFill(['status' => 'revoked'])->save();
    }
}

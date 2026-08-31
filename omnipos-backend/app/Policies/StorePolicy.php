<?php

namespace App\Policies;

use App\Models\Store;
use App\Models\StoreMember;
use App\Models\User;

/**
 * Direct port of the Supabase stores RLS policies (000 + 011).
 *
 * Supabase equivalents, for reference during review:
 *   stores_select_member      -> view()
 *   stores_insert_authenticated -> create()
 *   stores_update_admin       -> update()
 */
class StorePolicy
{
    public function viewAny(User $user): bool
    {
        return true;
    }

    public function view(User $user, Store $store): bool
    {
        return $user->is_super_admin
            || $user->isMemberOf($store->id)
            || $store->owner_user_id === $user->id;
    }

    public function create(User $user): bool
    {
        // Any authenticated user may create their first store, matching the
        // mobile sign-up flow which bootstraps a store for a new owner.
        return true;
    }

    public function update(User $user, Store $store): bool
    {
        return $user->hasStoreRole($store->id, [StoreMember::ROLE_ADMIN]);
    }

    public function delete(User $user, Store $store): bool
    {
        return $user->is_super_admin;
    }

    /** Provisioning a store on someone else's behalf is a platform operation. */
    public function provision(User $user): bool
    {
        return $user->is_super_admin;
    }

    public function manageStaff(User $user, Store $store): bool
    {
        return $user->hasStoreRole($store->id, [StoreMember::ROLE_ADMIN, StoreMember::ROLE_MANAGER]);
    }
}

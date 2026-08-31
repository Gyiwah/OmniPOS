<?php

namespace App\Policies;

use App\Models\Product;
use App\Models\StoreMember;
use App\Models\User;

/**
 * Port of products_select_member / products_write_manager_admin, plus the
 * cashier write allowance from Supabase migration 006.
 */
class ProductPolicy
{
    public function view(User $user, Product $product): bool
    {
        return $user->isMemberOf($product->store_id) || $user->is_super_admin;
    }

    public function create(User $user, string $storeId): bool
    {
        return $user->hasStoreRole($storeId, [StoreMember::ROLE_ADMIN, StoreMember::ROLE_MANAGER]);
    }

    public function update(User $user, Product $product): bool
    {
        return $user->hasStoreRole($product->store_id, [StoreMember::ROLE_ADMIN, StoreMember::ROLE_MANAGER]);
    }

    public function delete(User $user, Product $product): bool
    {
        return $user->hasStoreRole($product->store_id, [StoreMember::ROLE_ADMIN, StoreMember::ROLE_MANAGER]);
    }

    /**
     * Cashiers may move stock (that is what selling is) but may not change what a
     * product is or what it costs.
     */
    public function adjustStock(User $user, Product $product): bool
    {
        return $user->hasStoreRole($product->store_id, [
            StoreMember::ROLE_ADMIN,
            StoreMember::ROLE_MANAGER,
            StoreMember::ROLE_CASHIER,
        ]);
    }

    /**
     * Cost price and margin are commercially sensitive. The mobile plan gates
     * these behind a manager PIN; the API gates them by role.
     */
    public function viewCost(User $user, Product $product): bool
    {
        return $user->hasStoreRole($product->store_id, [StoreMember::ROLE_ADMIN, StoreMember::ROLE_MANAGER]);
    }
}

<?php

namespace App\Policies;

use App\Models\Order;
use App\Models\StoreMember;
use App\Models\User;

/**
 * Port of orders_select_member / orders_insert_cashier_plus /
 * orders_update_manager_admin.
 *
 * The asymmetry is deliberate and matches the Supabase policies: a cashier can
 * create a sale but cannot alter or void one afterwards. That is the control that
 * stops a till operator ringing up a sale, pocketing the cash and voiding the
 * record.
 */
class OrderPolicy
{
    public function view(User $user, Order $order): bool
    {
        return $user->isMemberOf($order->store_id) || $user->is_super_admin;
    }

    public function create(User $user, string $storeId): bool
    {
        return $user->hasStoreRole($storeId, [
            StoreMember::ROLE_ADMIN,
            StoreMember::ROLE_MANAGER,
            StoreMember::ROLE_CASHIER,
        ]);
    }

    public function update(User $user, Order $order): bool
    {
        return $user->hasStoreRole($order->store_id, [StoreMember::ROLE_ADMIN, StoreMember::ROLE_MANAGER]);
    }

    public function void(User $user, Order $order): bool
    {
        return $user->hasStoreRole($order->store_id, [StoreMember::ROLE_ADMIN, StoreMember::ROLE_MANAGER]);
    }

    public function refund(User $user, Order $order): bool
    {
        return $user->hasStoreRole($order->store_id, [StoreMember::ROLE_ADMIN, StoreMember::ROLE_MANAGER]);
    }
}

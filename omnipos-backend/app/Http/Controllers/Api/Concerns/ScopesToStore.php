<?php

namespace App\Http\Controllers\Api\Concerns;

use Illuminate\Http\Request;

/**
 * Every store-scoped controller starts here.
 *
 * The store id comes from the request attributes, where EnsureStoreAccess put it
 * after verifying membership — never from the query string or body. Reading the
 * raw input instead would let any authenticated user name any store and receive
 * another tenant's data, which is exactly the failure mode Supabase RLS used to
 * make impossible.
 */
trait ScopesToStore
{
    protected function storeId(Request $request): string
    {
        $storeId = $request->attributes->get('store_id');

        if (! is_string($storeId) || $storeId === '') {
            // Reaching here means the route is missing the store.access
            // middleware. Fail loudly rather than falling back to unscoped data.
            abort(500, 'Store context missing. This route must use the store.access middleware.');
        }

        return $storeId;
    }

    /** Role the caller holds in this store: admin, manager, cashier, or super_admin. */
    protected function storeRole(Request $request): ?string
    {
        $role = $request->attributes->get('store_role');

        return is_string($role) ? $role : null;
    }

    /** Pagination size, bounded so a client cannot ask for the whole table. */
    protected function perPage(Request $request, int $default = 50, int $max = 200): int
    {
        return min($max, max(1, (int) $request->query('per_page', $default)));
    }
}

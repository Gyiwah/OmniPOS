<?php

namespace App\Http\Middleware;

use App\Models\Store;
use App\Models\StoreMember;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Replaces Supabase RLS as the tenancy boundary.
 *
 * This is the most important security control in the application. Under Supabase,
 * every table carried a policy calling is_store_member(store_id), so a query that
 * forgot to filter by store still returned nothing it should not. Postgres gives
 * us no such backstop here: a missing WHERE clause returns every tenant's rows.
 *
 * Every store-scoped route must therefore run this middleware. It resolves the
 * store from the request, verifies the caller is a member (or a super admin), and
 * publishes the result so controllers can scope from a value that has actually
 * been authorised rather than from raw, attacker-controlled input.
 *
 * Optional role arguments narrow it further:
 *
 *     Route::post(...)->middleware('store.access:admin,manager');
 *
 * Controllers must read the store id from $request->attributes->get('store_id'),
 * NOT from the query string, or the check accomplishes nothing.
 */
class EnsureStoreAccess
{
    public function handle(Request $request, Closure $next, string ...$roles): Response
    {
        $user = $request->user();

        if (! $user) {
            abort(401, 'Unauthenticated.');
        }

        $storeId = $this->resolveStoreId($request);

        if (! $storeId) {
            abort(400, 'A store context is required for this request.');
        }

        // Load memberships once; User::roleIn and hasStoreRole read the relation.
        $user->loadMissing('memberships');

        $targetStore = Store::find($storeId);
        if (! $targetStore) {
            abort(404, 'Store not found.');
        }

        // The store admin of the parent store is always an admin of all branches
        $isParentAdmin = $targetStore->parent_store_id !== null && $user->hasStoreRole($targetStore->parent_store_id, [StoreMember::ROLE_ADMIN]);
        $isMember = $user->isMemberOf($storeId) || $isParentAdmin;

        if (! $user->is_super_admin && ! $isMember) {
            // 404 rather than 403: confirming that a store exists to a
            // non-member leaks the tenant list.
            abort(404, 'Store not found.');
        }

        $effectiveRole = $user->is_super_admin
            ? 'super_admin'
            : ($isParentAdmin ? StoreMember::ROLE_ADMIN : $user->roleIn($storeId));

        if ($roles !== [] && ! $user->is_super_admin && ! in_array($effectiveRole, $roles, true)) {
            abort(403, 'Your role does not permit this action.');
        }

        $request->attributes->set('store_id', $storeId);
        $request->attributes->set('store_role', $effectiveRole);

        return $next($request);
    }

    /**
     * Route parameter first, then an explicit header, then the request body.
     *
     * The header is what the mobile and web sync clients send; the body form
     * exists for sync push, whose payload names its own store.
     */
    private function resolveStoreId(Request $request): ?string
    {
        $candidate = $request->route('store')
            ?? $request->header('X-Store-Id')
            ?? $request->input('store_id');

        if ($candidate instanceof Store) {
            return $candidate->getKey();
        }

        return is_string($candidate) && $candidate !== '' ? $candidate : null;
    }
}

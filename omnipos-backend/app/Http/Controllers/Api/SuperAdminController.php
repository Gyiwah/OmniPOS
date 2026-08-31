<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\Order;
use App\Models\Store;
use App\Models\StoreMember;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

/**
 * Platform operations. Replaces the create-store-with-admin Edge Function and
 * the provision_store_with_admin RPC.
 *
 * Those ran with a service-role key, which bypassed row-level security
 * entirely; the only thing standing between a caller and creating arbitrary
 * users was the is_super_admin check they performed by hand. That check is now
 * the route's job and this controller's, and it is the reason nothing here is
 * store-scoped: a super admin operates across tenants by definition, so the
 * usual boundary cannot apply and the privilege must be verified explicitly.
 */
class SuperAdminController extends Controller
{
    private function assertSuperAdmin(Request $request): void
    {
        abort_unless($request->user()?->is_super_admin, 403, 'This action is limited to platform administrators.');
    }

    /** GET /api/admin/stores */
    public function stores(Request $request): JsonResponse
    {
        $this->assertSuperAdmin($request);

        $stores = Store::with('owner:id,name,email')->withCount('members')->orderBy('name')->get();

        return response()->json([
            'data' => $stores->map(fn (Store $s) => [
                'id' => $s->id,
                'name' => $s->name,
                'currency' => $s->currency,
                'timezone' => $s->timezone,
                'parent_store_id' => $s->parent_store_id,
                'members_count' => $s->members_count,
                'owner' => $s->owner ? ['id' => $s->owner->id, 'name' => $s->owner->name, 'email' => $s->owner->email] : null,
                'created_at' => $s->created_at?->toIso8601String(),
                // Cheap signal of whether a store is actually being used, which
                // is the first thing anyone asks when looking at this list.
                'orders_count' => Order::where('store_id', $s->id)->count(),
            ]),
        ]);
    }

    /**
     * POST /api/admin/stores
     *
     * Creates a store and the admin who will run it, in one transaction. Doing
     * it in two steps is how you end up with a store nobody can administer,
     * which needs another platform admin to repair.
     */
    public function provision(Request $request): JsonResponse
    {
        $this->assertSuperAdmin($request);

        $data = $request->validate([
            'store_name' => ['required', 'string', 'max:255'],
            'currency' => ['sometimes', 'string', 'max:8'],
            'timezone' => ['sometimes', 'string', 'max:64'],
            'tax_profile' => ['sometimes', 'string', 'max:64'],
            'admin_email' => ['required', 'email', 'max:255'],
            'admin_name' => ['sometimes', 'string', 'max:255'],
            // Only required when the account does not exist yet; an existing
            // user keeps the password they already chose.
            'admin_password' => ['nullable', 'string', 'min:8'],
            'parent_store_id' => ['nullable', 'uuid', Rule::exists('stores', 'id')],
        ]);

        $email = Str::lower(trim($data['admin_email']));
        $existing = User::where('email', $email)->first();

        if (! $existing && empty($data['admin_password'])) {
            return response()->json([
                'message' => 'This email has no account yet, so a password is required to create one.',
            ], 422);
        }

        $result = DB::transaction(function () use ($data, $email, $existing, $request) {
            $admin = $existing;

            if (! $admin) {
                $admin = User::create([
                    'name' => $data['admin_name'] ?? Str::before($email, '@'),
                    'email' => $email,
                    'password' => Hash::make($data['admin_password']),
                ]);

                // There is no verification email to send: a platform operator
                // created this account by hand and handed over the password, so
                // the address is as confirmed as it is going to get. Set outside
                // the fillable list, which deliberately excludes it so an
                // ordinary request can never mark itself verified.
                $admin->forceFill(['email_verified_at' => now()])->save();
            } elseif (! empty($data['admin_name'])) {
                $admin->forceFill(['name' => $data['admin_name']])->save();
            }

            $store = Store::create([
                'name' => trim($data['store_name']),
                'owner_user_id' => $admin->id,
                'currency' => $data['currency'] ?? 'USD',
                'timezone' => $data['timezone'] ?? 'UTC',
                'tax_profile' => $data['tax_profile'] ?? 'standard',
                'parent_store_id' => $data['parent_store_id'] ?? null,
            ]);

            StoreMember::updateOrCreate(
                ['store_id' => $store->id, 'user_id' => $admin->id],
                ['role' => StoreMember::ROLE_ADMIN],
            );

            AuditLog::create([
                'store_id' => $store->id,
                'user_id' => $request->user()->id,
                'action' => 'platform.store_provisioned',
                'entity_type' => 'store',
                'entity_id' => $store->id,
                'after' => [
                    'store_name' => $store->name,
                    'admin_email' => $email,
                    'admin_created' => $existing === null,
                ],
                'ip_address' => $request->ip(),
                'user_agent' => $request->userAgent(),
            ]);

            return ['store' => $store, 'admin' => $admin, 'created' => $existing === null];
        });

        return response()->json([
            'store' => [
                'id' => $result['store']->id,
                'name' => $result['store']->name,
                'currency' => $result['store']->currency,
                'timezone' => $result['store']->timezone,
            ],
            'admin' => [
                'id' => $result['admin']->id,
                'name' => $result['admin']->name,
                'email' => $result['admin']->email,
            ],
            // Tells the caller whether to hand over credentials or simply say
            // "your existing login now has access".
            'account_created' => $result['created'],
        ], 201);
    }
}

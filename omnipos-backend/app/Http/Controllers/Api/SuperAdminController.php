<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\Device;
use App\Models\GlobalCategory;
use App\Models\Order;
use App\Models\Plan;
use App\Models\Store;
use App\Models\StoreMember;
use App\Models\SyncConflict;
use App\Models\SyncOperation;
use App\Models\Subscription;
use App\Models\SystemSetting;
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

    /** GET /api/admin/dashboard */
    public function dashboard(Request $request): JsonResponse
    {
        $this->assertSuperAdmin($request);

        return response()->json([
            'stores' => [
                'total' => Store::count(),
                'active' => Store::where('platform_status', 'active')->count(),
                'inactive' => Store::whereIn('platform_status', ['inactive', 'suspended'])->count(),
                'branches' => Store::whereNotNull('parent_store_id')->count(),
            ],
            'users' => [
                'total' => User::count(),
                'active' => User::whereNull('deleted_at')->count(),
                'super_admins' => User::where('is_super_admin', true)->count(),
            ],
            'devices' => [
                'total' => Device::count(),
                'online' => Device::where('platform_status', 'active')->where('last_seen_at', '>=', now()->subMinutes(15))->count(),
            ],
            'sync' => [
                'pending' => SyncOperation::whereIn('status', ['pending', 'failed'])->count(),
                'failed' => SyncOperation::where('status', 'failed')->count(),
            ],
            'audit_events_today' => AuditLog::where('created_at', '>=', today())->count(),
        ]);
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
                'platform_status' => $s->platform_status,
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

    /** GET /api/admin/branches */
    public function branches(Request $request): JsonResponse
    {
        $this->assertSuperAdmin($request);

        $branches = Store::with(['parent:id,name', 'owner:id,name,email'])
            ->withCount('members')
            ->whereNotNull('parent_store_id')
            ->orderBy('name')
            ->get();

        return response()->json([
            'data' => $branches->map(fn (Store $branch) => [
                'id' => $branch->id,
                'name' => $branch->name,
                'platform_status' => $branch->platform_status,
                'parent_store' => $branch->parent ? ['id' => $branch->parent->id, 'name' => $branch->parent->name] : null,
                'owner' => $branch->owner ? ['id' => $branch->owner->id, 'name' => $branch->owner->name, 'email' => $branch->owner->email] : null,
                'members_count' => $branch->members_count,
                'created_at' => $branch->created_at?->toIso8601String(),
                'orders_count' => Order::where('store_id', $branch->id)->count(),
            ]),
        ]);
    }

    /** PATCH /api/admin/stores/{store} */
    public function updateStore(Request $request, Store $store): JsonResponse
    {
        $this->assertSuperAdmin($request);
        $data = $request->validate([
            'name' => ['sometimes', 'string', 'max:255'],
            'owner_user_id' => ['sometimes', 'uuid', Rule::exists('users', 'id')],
            'currency' => ['sometimes', 'nullable', 'string', 'max:8'],
            'timezone' => ['sometimes', 'nullable', 'string', 'max:64'],
            'language' => ['sometimes', 'nullable', 'string', 'max:32'],
            'platform_status' => ['sometimes', Rule::in(['active', 'suspended', 'inactive'])],
            'tax_profile' => ['sometimes', 'nullable', 'string', 'max:64'],
        ]);

        $before = $store->only(['name', 'owner_user_id', 'currency', 'timezone', 'language', 'platform_status', 'tax_profile']);
        $store->fill($data);
        $store->save();

        AuditLog::create([
            'store_id' => $store->id,
            'user_id' => $request->user()->id,
            'action' => 'platform.store_updated',
            'entity_type' => 'store',
            'entity_id' => $store->id,
            'before' => $before,
            'after' => $store->only(['name', 'owner_user_id', 'currency', 'timezone', 'language', 'platform_status', 'tax_profile']),
            'ip_address' => $request->ip(),
            'user_agent' => $request->userAgent(),
        ]);

        return response()->json(['store' => $store]);
    }

    /** DELETE /api/admin/stores/{store} */
    public function deleteStore(Request $request, Store $store): JsonResponse
    {
        $this->assertSuperAdmin($request);

        $store->delete();

        AuditLog::create([
            'store_id' => $store->id,
            'user_id' => $request->user()->id,
            'action' => 'platform.store_deleted',
            'entity_type' => 'store',
            'entity_id' => $store->id,
            'before' => ['name' => $store->name],
            'ip_address' => $request->ip(),
            'user_agent' => $request->userAgent(),
        ]);

        return response()->json(['deleted' => true]);
    }

    /** POST /api/admin/branches */
    public function createBranch(Request $request): JsonResponse
    {
        $this->assertSuperAdmin($request);

        $data = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'parent_store_id' => ['required', 'uuid', Rule::exists('stores', 'id')],
            'owner_user_id' => ['sometimes', 'uuid', Rule::exists('users', 'id')],
            'currency' => ['sometimes', 'nullable', 'string', 'max:8'],
            'timezone' => ['sometimes', 'nullable', 'string', 'max:64'],
            'language' => ['sometimes', 'nullable', 'string', 'max:32'],
            'platform_status' => ['sometimes', Rule::in(['active', 'suspended', 'inactive'])],
            'tax_profile' => ['sometimes', 'nullable', 'string', 'max:64'],
        ]);

        $branch = Store::create($data + ['platform_status' => $data['platform_status'] ?? 'active']);

        AuditLog::create([
            'store_id' => $branch->id,
            'user_id' => $request->user()->id,
            'action' => 'platform.branch_created',
            'entity_type' => 'store',
            'entity_id' => $branch->id,
            'after' => $branch->only(['name', 'parent_store_id', 'owner_user_id', 'currency', 'timezone', 'platform_status']),
            'ip_address' => $request->ip(),
            'user_agent' => $request->userAgent(),
        ]);

        return response()->json(['branch' => $branch], 201);
    }

    /** PATCH /api/admin/branches/{branch} */
    public function updateBranch(Request $request, Store $branch): JsonResponse
    {
        $this->assertSuperAdmin($request);
        $data = $request->validate([
            'name' => ['sometimes', 'string', 'max:255'],
            'parent_store_id' => ['sometimes', 'uuid', Rule::exists('stores', 'id')],
            'owner_user_id' => ['sometimes', 'uuid', Rule::exists('users', 'id')],
            'currency' => ['sometimes', 'nullable', 'string', 'max:8'],
            'timezone' => ['sometimes', 'nullable', 'string', 'max:64'],
            'language' => ['sometimes', 'nullable', 'string', 'max:32'],
            'platform_status' => ['sometimes', Rule::in(['active', 'suspended', 'inactive'])],
            'tax_profile' => ['sometimes', 'nullable', 'string', 'max:64'],
        ]);

        $before = $branch->only(['name', 'parent_store_id', 'owner_user_id', 'currency', 'timezone', 'language', 'platform_status', 'tax_profile']);
        $branch->fill($data);
        $branch->save();

        AuditLog::create([
            'store_id' => $branch->id,
            'user_id' => $request->user()->id,
            'action' => 'platform.branch_updated',
            'entity_type' => 'store',
            'entity_id' => $branch->id,
            'before' => $before,
            'after' => $branch->only(['name', 'parent_store_id', 'owner_user_id', 'currency', 'timezone', 'language', 'platform_status', 'tax_profile']),
            'ip_address' => $request->ip(),
            'user_agent' => $request->userAgent(),
        ]);

        return response()->json(['branch' => $branch]);
    }

    /** DELETE /api/admin/branches/{branch} */
    public function deleteBranch(Request $request, Store $branch): JsonResponse
    {
        $this->assertSuperAdmin($request);
        $branch->delete();

        AuditLog::create([
            'store_id' => $branch->id,
            'user_id' => $request->user()->id,
            'action' => 'platform.branch_deleted',
            'entity_type' => 'store',
            'entity_id' => $branch->id,
            'before' => ['name' => $branch->name],
            'ip_address' => $request->ip(),
            'user_agent' => $request->userAgent(),
        ]);

        return response()->json(['deleted' => true]);
    }

    /** GET /api/admin/stores/{store}/members */
        public function members(Request $request, string $store): JsonResponse
        {
            $this->assertSuperAdmin($request);

            $model = Store::findOrFail($store);

            return response()->json([
                'store' => ['id' => $model->id, 'name' => $model->name],
                'data' => $model->members()->with('user:id,name,email,is_super_admin')->get()->map(fn (StoreMember $member) => [
                    'id' => $member->id,
                    'role' => $member->role,
                    'user' => $member->user ? [
                        'id' => $member->user->id,
                        'name' => $member->user->name,
                        'email' => $member->user->email,
                        'is_super_admin' => $member->user->is_super_admin,
                    ] : null,
                ]),
            ]);
        }

    /** GET /api/admin/users */
        public function users(Request $request): JsonResponse
        {
            $this->assertSuperAdmin($request);

            return response()->json(['data' => User::withCount('memberships')->with('memberships.store:id,name')->orderBy('name')->get()->map(fn (User $user) => [
                'id' => $user->id,
                'name' => $user->name,
                'email' => $user->email,
                'is_super_admin' => $user->is_super_admin,
                'active' => $user->deleted_at === null,
                'stores_count' => $user->memberships_count,
                'stores' => $user->memberships->map(fn (StoreMember $member) => ['store_id' => $member->store_id, 'store_name' => $member->store?->name, 'role' => $member->role]),
            ])]);
        }

    /** GET /api/admin/people */
    public function people(Request $request): JsonResponse
    {
        $this->assertSuperAdmin($request);

        return response()->json(['data' => User::with('memberships.store:id,name')->orderBy('name')->get()->map(fn (User $user) => [
            'id' => $user->id,
            'name' => $user->name,
            'email' => $user->email,
            'is_super_admin' => (bool) $user->is_super_admin,
            'active' => $user->deleted_at === null,
            'member_stores' => $user->memberships->map(fn (StoreMember $member) => [
                'store_id' => $member->store_id,
                'store_name' => $member->store?->name,
                'role' => $member->role,
            ]),
        ])]);
    }

    /** PATCH /api/admin/people/{user}/stores/{store} */
    public function updateStoreMembershipRole(Request $request, string $user, string $store): JsonResponse
    {
        $this->assertSuperAdmin($request);

        $data = $request->validate(['role' => ['required', Rule::in(StoreMember::ROLES)]]);
        $member = StoreMember::where('user_id', $user)->where('store_id', $store)->firstOrFail();
        $before = $member->role;

        $member->update(['role' => $data['role']]);
        AuditLog::create([
            'store_id' => $store,
            'user_id' => $request->user()->id,
            'action' => 'platform.store_member_role_changed',
            'entity_type' => 'store_member',
            'entity_id' => $member->id,
            'before' => ['role' => $before],
            'after' => ['role' => $member->role],
            'ip_address' => $request->ip(),
            'user_agent' => $request->userAgent(),
        ]);

        return response()->json(['member' => ['id' => $member->id, 'role' => $member->role]]);
    }

    /** PATCH /api/admin/people/{user}/platform-admin */
    public function updatePlatformAdmin(Request $request, string $user): JsonResponse
    {
        $this->assertSuperAdmin($request);
        $data = $request->validate(['is_super_admin' => ['required', 'boolean']]);
        $model = User::findOrFail($user);
        $model->update(['is_super_admin' => $data['is_super_admin']]);

        AuditLog::create([
            'user_id' => $request->user()->id,
            'action' => 'platform.user_super_admin_changed',
            'entity_type' => 'user',
            'entity_id' => $model->id,
            'before' => ['is_super_admin' => ! $data['is_super_admin']],
            'after' => ['is_super_admin' => $model->is_super_admin],
            'ip_address' => $request->ip(),
            'user_agent' => $request->userAgent(),
        ]);

        return response()->json(['user' => ['id' => $model->id, 'is_super_admin' => (bool) $model->is_super_admin]]);
    }

    /** GET /api/admin/devices */
        public function devices(Request $request): JsonResponse
        {
            $this->assertSuperAdmin($request);

            return response()->json(['data' => Device::with(['store:id,name,parent_store_id', 'user:id,name,email'])->latest('last_seen_at')->get()->map(fn (Device $device) => [
                'id' => $device->id,
                'platform' => $device->platform,
                'terminal_label' => $device->terminal_label,
                'app_version' => $device->app_version,
                'platform_status' => $device->platform_status,
                'last_seen_at' => $device->last_seen_at?->toIso8601String(),
                'store' => $device->store ? ['id' => $device->store->id, 'name' => $device->store->name, 'parent_store_id' => $device->store->parent_store_id] : null,
                'user' => $device->user ? ['name' => $device->user->name, 'email' => $device->user->email] : null,
            ])]);
        }

        /** GET /api/admin/audit-logs */
        public function auditLogs(Request $request): JsonResponse
        {
            $this->assertSuperAdmin($request);

            $data = $request->validate([
                'action' => ['sometimes', 'string', 'max:120'],
                'store_id' => ['sometimes', 'uuid'],
                'limit' => ['sometimes', 'integer', 'min:1', 'max:100'],
            ]);

            $logs = AuditLog::query()
                ->with(['user:id,name,email'])
                ->when($data['action'] ?? null, fn ($query, string $action) => $query->where('action', 'like', "%{$action}%"))
                ->when($data['store_id'] ?? null, fn ($query, string $storeId) => $query->where('store_id', $storeId))
                ->latest('created_at')
                ->limit($data['limit'] ?? 50)
                ->get();

            return response()->json(['data' => $logs->map(fn (AuditLog $log) => [
                'id' => $log->id,
                'action' => $log->action,
                'entity_type' => $log->entity_type,
                'entity_id' => $log->entity_id,
                'store_id' => $log->store_id,
                'user' => $log->user ? ['name' => $log->user->name, 'email' => $log->user->email] : null,
                'before' => $log->before,
                'after' => $log->after,
                'ip_address' => $log->ip_address,
                'created_at' => $log->created_at?->toIso8601String(),
            ])]);
        }

        /** GET /api/admin/sync-monitor */
        public function syncMonitor(Request $request): JsonResponse
        {
            $this->assertSuperAdmin($request);

            $onlineSince = now()->subMinutes(15);
            $stores = Store::withCount([
                'members',
                'orders',
                'devices',
            ])->with([
                'devices' => fn ($query) => $query->select('id', 'store_id', 'terminal_label', 'platform', 'last_seen_at', 'platform_status'),
            ])->orderBy('name')->get();

            $operations = SyncOperation::with(['store:id,name', 'device:id,terminal_label,platform'])
                ->whereIn('status', [SyncOperation::STATUS_FAILED, SyncOperation::STATUS_CONFLICT])
                ->latest('created_at')
                ->limit(50)
                ->get();

            return response()->json([
                'summary' => [
                    'stores_online' => $stores->filter(fn (Store $store) => $store->devices->contains(fn (Device $device) => $device->last_seen_at?->greaterThanOrEqualTo($onlineSince)))->count(),
                    'stores_total' => $stores->count(),
                    'devices_online' => Device::where('platform_status', 'active')->where('last_seen_at', '>=', $onlineSince)->count(),
                    'devices_total' => Device::count(),
                    'pending_operations' => SyncOperation::whereNull('processed_at')->count(),
                    'failed_operations' => SyncOperation::where('status', SyncOperation::STATUS_FAILED)->count(),
                    'open_conflicts' => SyncConflict::pending()->count(),
                ],
                'stores' => $stores->map(fn (Store $store) => [
                    'id' => $store->id,
                    'name' => $store->name,
                    'platform_status' => $store->platform_status,
                    'devices' => $store->devices->map(fn (Device $device) => [
                        'id' => $device->id,
                        'label' => $device->terminal_label ?? $device->platform,
                        'platform' => $device->platform,
                        'status' => $device->platform_status,
                        'online' => $device->last_seen_at?->greaterThanOrEqualTo($onlineSince) ?? false,
                        'last_seen_at' => $device->last_seen_at?->toIso8601String(),
                    ]),
                ]),
                'recent_failures' => $operations->map(fn (SyncOperation $operation) => [
                    'operation_id' => $operation->operation_id,
                    'status' => $operation->status,
                    'store' => $operation->store?->name,
                    'device' => $operation->device?->terminal_label ?? $operation->device?->platform,
                    'entity' => $operation->entity,
                    'record_id' => $operation->record_id,
                    'error' => $operation->error,
                    'created_at' => $operation->created_at?->toIso8601String(),
                ]),
            ]);
        }

        /** GET /api/admin/plans */
        public function plans(Request $request): JsonResponse
        {
            $this->assertSuperAdmin($request);

            return response()->json(['data' => Plan::withCount('subscriptions')->orderBy('monthly_price')->get()->map(fn (Plan $plan) => [
                'id' => $plan->id,
                'name' => $plan->name,
                'slug' => $plan->slug,
                'description' => $plan->description,
                'monthly_price' => $plan->monthly_price,
                'limits' => $plan->limits ?? [],
                'platform_status' => $plan->platform_status,
                'subscriptions_count' => $plan->subscriptions_count,
            ])]);
        }

        /** POST /api/admin/plans */
        public function createPlan(Request $request): JsonResponse
        {
            $this->assertSuperAdmin($request);
            $data = $request->validate([
                'name' => ['required', 'string', 'max:120'],
                'slug' => ['required', 'alpha_dash', 'max:80', 'unique:plans,slug'],
                'description' => ['nullable', 'string', 'max:1000'],
                'monthly_price' => ['required', 'numeric', 'min:0'],
                'limits' => ['nullable', 'array'],
            ]);

            $plan = Plan::create($data + ['platform_status' => 'active']);
            AuditLog::create(['user_id' => $request->user()->id, 'action' => 'platform.plan_created', 'entity_type' => 'plan', 'entity_id' => $plan->id, 'after' => $plan->only(['name', 'slug', 'monthly_price', 'limits']), 'ip_address' => $request->ip(), 'user_agent' => $request->userAgent()]);

            return response()->json(['plan' => $plan], 201);
        }

        /** PATCH /api/admin/plans/{plan} */
        public function updatePlan(Request $request, Plan $plan): JsonResponse
        {
            $this->assertSuperAdmin($request);
            $data = $request->validate([
                'name' => ['sometimes', 'string', 'max:120'],
                'slug' => ['sometimes', 'alpha_dash', 'max:80', Rule::unique('plans', 'slug')->ignore($plan->id)],
                'description' => ['sometimes', 'nullable', 'string', 'max:1000'],
                'monthly_price' => ['sometimes', 'numeric', 'min:0'],
                'limits' => ['sometimes', 'nullable', 'array'],
                'platform_status' => ['sometimes', Rule::in(['active', 'archived', 'inactive'])],
            ]);

            $before = $plan->only(['name', 'slug', 'description', 'monthly_price', 'limits', 'platform_status']);
            $plan->fill($data);
            $plan->save();

            AuditLog::create([
                'user_id' => $request->user()->id,
                'action' => 'platform.plan_updated',
                'entity_type' => 'plan',
                'entity_id' => $plan->id,
                'before' => $before,
                'after' => $plan->only(['name', 'slug', 'description', 'monthly_price', 'limits', 'platform_status']),
                'ip_address' => $request->ip(),
                'user_agent' => $request->userAgent(),
            ]);

            return response()->json(['plan' => $plan]);
        }

        /** DELETE /api/admin/plans/{plan} */
        public function deletePlan(Request $request, Plan $plan): JsonResponse
        {
            $this->assertSuperAdmin($request);
            $before = $plan->only(['name', 'slug', 'platform_status']);
            $plan->update(['platform_status' => 'archived']);

            AuditLog::create([
                'user_id' => $request->user()->id,
                'action' => 'platform.plan_archived',
                'entity_type' => 'plan',
                'entity_id' => $plan->id,
                'before' => $before,
                'after' => $plan->only(['name', 'slug', 'platform_status']),
                'ip_address' => $request->ip(),
                'user_agent' => $request->userAgent(),
            ]);

            return response()->json(['deleted' => true]);
        }

        /** GET /api/admin/subscriptions */
        public function subscriptions(Request $request): JsonResponse
        {
            $this->assertSuperAdmin($request);

            return response()->json(['data' => Subscription::with(['store:id,name,platform_status', 'plan:id,name,slug,monthly_price'])->latest()->get()->map(fn (Subscription $subscription) => [
                'id' => $subscription->id,
                'status' => $subscription->status,
                'starts_at' => $subscription->starts_at?->toIso8601String(),
                'ends_at' => $subscription->ends_at?->toIso8601String(),
                'store' => $subscription->store ? ['id' => $subscription->store->id, 'name' => $subscription->store->name, 'platform_status' => $subscription->store->platform_status] : null,
                'plan' => $subscription->plan ? ['id' => $subscription->plan->id, 'name' => $subscription->plan->name, 'monthly_price' => $subscription->plan->monthly_price] : null,
            ])]);
        }

        /** POST /api/admin/stores/{store}/subscription */
        public function assignSubscription(Request $request, string $store): JsonResponse
        {
            $this->assertSuperAdmin($request);
            $data = $request->validate([
                'plan_id' => ['required', 'uuid', Rule::exists('plans', 'id')],
                'status' => ['sometimes', Rule::in(['active', 'suspended', 'expired'])],
                'ends_at' => ['nullable', 'date'],
            ]);

            $storeModel = Store::findOrFail($store);
            $plan = Plan::findOrFail($data['plan_id']);
            $subscription = $storeModel->subscriptions()->whereIn('status', ['active', 'suspended'])->latest()->first();
            $before = $subscription?->only(['plan_id', 'status', 'ends_at']);
            $subscription ??= new Subscription(['store_id' => $storeModel->id, 'starts_at' => now()]);
            $subscription->fill(['plan_id' => $plan->id, 'status' => $data['status'] ?? 'active', 'ends_at' => $data['ends_at'] ?? null]);
            $subscription->save();

            AuditLog::create(['store_id' => $storeModel->id, 'user_id' => $request->user()->id, 'action' => 'platform.subscription_changed', 'entity_type' => 'subscription', 'entity_id' => $subscription->id, 'before' => $before, 'after' => $subscription->only(['plan_id', 'status', 'ends_at']), 'ip_address' => $request->ip(), 'user_agent' => $request->userAgent()]);

            return response()->json(['subscription' => $subscription->load('plan:id,name,monthly_price')]);
        }

        /** GET /api/admin/system-resources */
        public function systemResources(Request $request): JsonResponse
        {
            $this->assertSuperAdmin($request);

            return response()->json([
                'categories' => GlobalCategory::orderBy('position')->orderBy('name')->get(['id', 'name', 'slug', 'status', 'position']),
                'settings' => SystemSetting::orderBy('key')->get(['key', 'value', 'description']),
            ]);
        }

        /** POST /api/admin/system-resources/categories */
        public function createGlobalCategory(Request $request): JsonResponse
        {
            $this->assertSuperAdmin($request);
            $data = $request->validate([
                'name' => ['required', 'string', 'max:120'],
                'slug' => ['required', 'alpha_dash', 'max:80', 'unique:global_categories,slug'],
                'position' => ['sometimes', 'integer', 'min:0'],
            ]);
            $category = GlobalCategory::create($data + ['status' => 'active']);
            AuditLog::create(['user_id' => $request->user()->id, 'action' => 'platform.global_category_created', 'entity_type' => 'global_category', 'entity_id' => $category->id, 'after' => $category->only(['name', 'slug', 'position']), 'ip_address' => $request->ip(), 'user_agent' => $request->userAgent()]);

            return response()->json(['category' => $category], 201);
        }

        /** PATCH /api/admin/system-resources/categories/{category} */
        public function updateGlobalCategory(Request $request, GlobalCategory $category): JsonResponse
        {
            $this->assertSuperAdmin($request);
            $data = $request->validate([
                'name' => ['sometimes', 'string', 'max:120'],
                'slug' => ['sometimes', 'alpha_dash', 'max:80', Rule::unique('global_categories', 'slug')->ignore($category->id)],
                'position' => ['sometimes', 'integer', 'min:0'],
                'status' => ['sometimes', Rule::in(['active', 'inactive'])],
            ]);

            $before = $category->only(['name', 'slug', 'position', 'status']);
            $category->fill($data);
            $category->save();

            AuditLog::create([
                'user_id' => $request->user()->id,
                'action' => 'platform.global_category_updated',
                'entity_type' => 'global_category',
                'entity_id' => $category->id,
                'before' => $before,
                'after' => $category->only(['name', 'slug', 'position', 'status']),
                'ip_address' => $request->ip(),
                'user_agent' => $request->userAgent(),
            ]);

            return response()->json(['category' => $category]);
        }

        /** DELETE /api/admin/system-resources/categories/{category} */
        public function deleteGlobalCategory(Request $request, GlobalCategory $category): JsonResponse
        {
            $this->assertSuperAdmin($request);
            $before = $category->only(['name', 'slug', 'status']);
            $category->delete();

            AuditLog::create([
                'user_id' => $request->user()->id,
                'action' => 'platform.global_category_deleted',
                'entity_type' => 'global_category',
                'entity_id' => $category->id,
                'before' => $before,
                'ip_address' => $request->ip(),
                'user_agent' => $request->userAgent(),
            ]);

            return response()->json(['deleted' => true]);
        }

        /** PATCH /api/admin/system-resources/settings/{key} */
        public function updateSystemSetting(Request $request, string $key): JsonResponse
        {
            $this->assertSuperAdmin($request);
            $data = $request->validate(['value' => ['nullable', 'array'], 'description' => ['sometimes', 'nullable', 'string', 'max:1000']]);
            $setting = SystemSetting::firstOrNew(['key' => $key]);
            $before = $setting->value;
            $setting->fill($data)->save();
            AuditLog::create(['user_id' => $request->user()->id, 'action' => 'platform.system_setting_changed', 'entity_type' => 'system_setting', 'entity_id' => null, 'before' => ['key' => $key, 'value' => $before], 'after' => ['key' => $key, 'value' => $setting->value], 'ip_address' => $request->ip(), 'user_agent' => $request->userAgent()]);

            return response()->json(['setting' => $setting]);
        }

    /** PATCH /api/admin/stores/{store}/status */
        public function updateStoreStatus(Request $request, string $store): JsonResponse
        {
            $this->assertSuperAdmin($request);
            $model = Store::findOrFail($store);
            $data = $request->validate(['status' => ['required', Rule::in(['active', 'suspended', 'inactive'])]]);
            $before = $model->platform_status;
            $model->update(['platform_status' => $data['status']]);

            AuditLog::create(['store_id' => $model->id, 'user_id' => $request->user()->id, 'action' => 'platform.store_status_changed', 'entity_type' => 'store', 'entity_id' => $model->id, 'before' => ['platform_status' => $before], 'after' => ['platform_status' => $model->platform_status], 'ip_address' => $request->ip(), 'user_agent' => $request->userAgent()]);

            return response()->json(['store' => ['id' => $model->id, 'platform_status' => $model->platform_status]]);
        }

    /** PATCH /api/admin/devices/{device}/status */
        public function updateDeviceStatus(Request $request, string $device): JsonResponse
        {
            $this->assertSuperAdmin($request);
            $model = Device::findOrFail($device);
            $data = $request->validate(['status' => ['required', Rule::in(['active', 'revoked', 'inactive'])]]);
            $before = $model->platform_status;
            $model->update(['platform_status' => $data['status']]);

            AuditLog::create(['store_id' => $model->store_id, 'user_id' => $request->user()->id, 'device_id' => $model->id, 'action' => 'platform.device_status_changed', 'entity_type' => 'device', 'entity_id' => $model->id, 'before' => ['platform_status' => $before], 'after' => ['platform_status' => $model->platform_status], 'ip_address' => $request->ip(), 'user_agent' => $request->userAgent()]);

            return response()->json(['device' => ['id' => $model->id, 'platform_status' => $model->platform_status]]);
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

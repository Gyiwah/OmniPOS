<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Api\Concerns\ScopesToStore;
use App\Http\Controllers\Controller;
use App\Http\Resources\StoreInviteResource;
use App\Http\Resources\StoreMemberResource;
use App\Models\AuditLog;
use App\Models\Order;
use App\Models\Store;
use App\Models\StoreInvite;
use App\Models\StoreMember;
use App\Services\StoreInviteService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Validation\Rule;

/**
 * Staff and invitations. Replaces the invite-store-member Edge Function.
 *
 * The routes are gated to admin and manager by middleware; the extra checks in
 * here are the ones middleware cannot express — that a manager cannot mint an
 * admin, and that the last admin cannot be removed.
 */
class StoreMemberController extends Controller
{
    use ScopesToStore;

    public function __construct(private readonly StoreInviteService $invites)
    {
    }

    public function index(Request $request): AnonymousResourceCollection
    {
        return StoreMemberResource::collection(
            StoreMember::where('store_id', $this->storeId($request))
                ->with('user:id,name,email')
                ->get()
        );
    }

    /** GET /api/store-branches */
    public function branches(Request $request): JsonResponse
    {
        $storeId = $this->storeId($request);
        $branches = Store::where('parent_store_id', $storeId)
            ->withCount('members')
            ->orderBy('name')
            ->get();

        return response()->json([
            'data' => $branches->map(fn (Store $branch) => [
                'id' => $branch->id,
                'name' => $branch->name,
                'platform_status' => $branch->platform_status,
                'members_count' => $branch->members_count,
                'orders_count' => Order::where('store_id', $branch->id)->count(),
            ]),
        ]);
    }

    /** POST /api/store-branches */
    public function createBranch(Request $request): JsonResponse
    {
        $storeId = $this->storeId($request);
        $parent = Store::findOrFail($storeId);
        $data = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'platform_status' => ['sometimes', Rule::in(['active', 'suspended', 'inactive'])],
        ]);

        $branch = Store::create([
            ...$data,
            'parent_store_id' => $parent->id,
            'currency' => $parent->currency,
            'timezone' => $parent->timezone,
            'platform_status' => $data['platform_status'] ?? 'active',
        ]);

        $this->audit($request, 'staff.branch_created', $branch, null, $branch->only(['name', 'parent_store_id', 'platform_status']));

        return response()->json(['branch' => $branch], 201);
    }

    /** PATCH /api/store-branches/{branch} */
    public function updateBranch(Request $request, string $branch): JsonResponse
    {
        $storeId = $this->storeId($request);
        $model = Store::where('parent_store_id', $storeId)->findOrFail($branch);
        $data = $request->validate([
            'name' => ['sometimes', 'string', 'max:255'],
            'platform_status' => ['sometimes', Rule::in(['active', 'suspended', 'inactive'])],
        ]);
        $before = $model->only(['name', 'parent_store_id', 'platform_status']);
        $model->update($data);

        $this->audit($request, 'staff.branch_updated', $model, $before, $model->only(['name', 'parent_store_id', 'platform_status']));

        return response()->json(['branch' => $model->refresh()]);
    }

    /** DELETE /api/store-branches/{branch} */
    public function deleteBranch(Request $request, string $branch): JsonResponse
    {
        $storeId = $this->storeId($request);
        $model = Store::where('parent_store_id', $storeId)->findOrFail($branch);
        $before = ['name' => $model->name, 'parent_store_id' => $model->parent_store_id];
        $model->delete();

        $this->audit($request, 'staff.branch_deleted', $model, $before, null);

        return response()->json(['deleted' => true]);
    }

    /**
     * PATCH /api/store-members/{member}
     *
     * Role changes are audited: who was promoted, by whom, and when.
     */
    public function update(Request $request, string $member): JsonResponse
    {
        $storeId = $this->storeId($request);
        $model = StoreMember::where('store_id', $storeId)->with('user')->findOrFail($member);

        $data = $request->validate([
            'role' => ['required', Rule::in(StoreMember::ROLES)],
        ]);

        $this->assertMayGrant($request, $data['role']);

        if ($model->role === StoreMember::ROLE_ADMIN && $data['role'] !== StoreMember::ROLE_ADMIN) {
            $this->assertNotLastAdmin($storeId, $model);
        }

        $before = $model->role;
        $model->update($data);

        AuditLog::create([
            'store_id' => $storeId,
            'user_id' => $request->user()->id,
            'action' => 'staff.role_changed',
            'entity_type' => 'store_member',
            'entity_id' => $model->id,
            'before' => ['role' => $before],
            'after' => ['role' => $model->role, 'user_id' => $model->user_id],
            'ip_address' => $request->ip(),
            'user_agent' => $request->userAgent(),
        ]);

        return response()->json(['member' => new StoreMemberResource($model->refresh()->load('user'))]);
    }

    /**
     * DELETE /api/store-members/{member}
     *
     * Removing the last admin would leave the store unadministrable — nobody
     * able to manage staff or settings, including the person who did it.
     */
    public function destroy(Request $request, string $member): JsonResponse
    {
        $storeId = $this->storeId($request);
        $model = StoreMember::where('store_id', $storeId)->findOrFail($member);

        abort_unless(
            $request->user()->hasStoreRole($storeId, [StoreMember::ROLE_ADMIN]),
            403,
            'Only an admin can remove staff.'
        );

        $this->assertNotLastAdmin($storeId, $model);

        $model->delete();

        AuditLog::create([
            'store_id' => $storeId,
            'user_id' => $request->user()->id,
            'action' => 'staff.removed',
            'entity_type' => 'store_member',
            'entity_id' => $model->id,
            'before' => ['user_id' => $model->user_id, 'role' => $model->role],
            'ip_address' => $request->ip(),
        ]);

        return response()->json(['deleted' => true]);
    }

    public function invites(Request $request): AnonymousResourceCollection
    {
        return StoreInviteResource::collection(
            StoreInvite::where('store_id', $this->storeId($request))
                ->latest('created_at')->get()
        );
    }

    /** POST /api/store-invites */
    public function invite(Request $request): JsonResponse
    {
        $storeId = $this->storeId($request);

        $data = $request->validate([
            'email' => ['required', 'email', 'max:255'],
            'role' => ['required', Rule::in(StoreMember::ROLES)],
        ]);

        $this->assertMayGrant($request, $data['role']);

        $store = Store::findOrFail($storeId);
        $this->authorize('manageStaff', $store);

        $invite = $this->invites->invite($storeId, $data['email'], $data['role'], $request->user());

        return response()->json([
            'invite' => new StoreInviteResource($invite),
            // The mailer is not wired yet, so say so plainly rather than
            // implying an email went out.
            'email_sent' => false,
            'message' => 'Invite recorded. It is accepted automatically when this person next signs in.',
        ], 201);
    }

    public function revokeInvite(Request $request, string $invite): JsonResponse
    {
        $model = StoreInvite::where('store_id', $this->storeId($request))->findOrFail($invite);

        $this->invites->revoke($model);

        return response()->json(['revoked' => true]);
    }

    /**
     * A manager can hire cashiers but cannot create another admin — otherwise
     * the admin/manager distinction is only as strong as a manager's restraint.
     */
    private function assertMayGrant(Request $request, string $role): void
    {
        if ($role !== StoreMember::ROLE_ADMIN) {
            return;
        }

        abort_unless(
            $request->user()->hasStoreRole($this->storeId($request), [StoreMember::ROLE_ADMIN]),
            403,
            'Only an admin can grant the admin role.'
        );
    }

    private function audit(Request $request, string $action, Store $branch, ?array $before, ?array $after): void
    {
        AuditLog::create([
            'store_id' => $this->storeId($request),
            'user_id' => $request->user()->id,
            'action' => $action,
            'entity_type' => 'store',
            'entity_id' => $branch->id,
            'before' => $before,
            'after' => $after,
            'ip_address' => $request->ip(),
            'user_agent' => $request->userAgent(),
        ]);
    }

    private function assertNotLastAdmin(string $storeId, StoreMember $member): void
    {
        if ($member->role !== StoreMember::ROLE_ADMIN) {
            return;
        }

        $admins = StoreMember::where('store_id', $storeId)
            ->where('role', StoreMember::ROLE_ADMIN)->count();

        abort_if($admins <= 1, 422, 'This is the last admin; promote someone else first.');
    }
}

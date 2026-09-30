<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Api\Concerns\ScopesToStore;
use App\Http\Controllers\Controller;
use App\Http\Resources\StoreResource;
use App\Models\Store;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class StoreController extends Controller
{
    use ScopesToStore;

    /**
     * GET /api/stores
     *
     * Only stores the caller belongs to; super admins see everything. This route
     * is deliberately NOT behind store.access — it is how a client discovers
     * which stores it may then ask about.
     */
    public function index(Request $request): AnonymousResourceCollection
    {
        $user = $request->user();

        $query = Store::with('branches');

        if (! $user->is_super_admin) {
            $memberStoreIds = $user->memberships()->pluck('store_id');
            $query->where(function ($q) use ($memberStoreIds) {
                $q->whereIn('id', $memberStoreIds)
                  ->orWhereIn('parent_store_id', $memberStoreIds);
            });
        }

        return StoreResource::collection($query->orderBy('name')->get());
    }

    public function show(Request $request): StoreResource
    {
        return new StoreResource(Store::with('branches')->findOrFail($this->storeId($request)));
    }

    /** PATCH /api/stores/{store} — settings. Admin only, via the policy. */
    public function update(Request $request): StoreResource
    {
        $store = Store::findOrFail($this->storeId($request));
        $this->authorize('update', $store);

        $store->update($request->validate([
            'name' => ['sometimes', 'string', 'max:255'],
            'email' => ['nullable', 'email', 'max:255'],
            'logo_url' => ['nullable', 'string', 'max:2048'],
            'currency' => ['sometimes', 'string', 'max:8'],
            'timezone' => ['sometimes', 'string', 'max:64'],
            'language' => ['sometimes', 'string', 'max:64'],
            'tax_profile' => ['sometimes', 'string', 'max:64'],
            'tax_rate' => ['sometimes', 'numeric', 'min:0', 'max:100'],
            'vat_rate' => ['sometimes', 'numeric', 'min:0', 'max:100'],
            'service_rate' => ['sometimes', 'numeric', 'min:0', 'max:100'],
            'app_mode_dark' => ['sometimes', 'boolean'],
        ]));

        return new StoreResource($store->refresh());
    }

    /**
     * POST /api/stores
     *
     * Creating a store makes the creator its admin, matching the mobile sign-up
     * flow which bootstraps a first store for a new owner.
     */
    public function store(Request $request): JsonResponse
    {
        $this->authorize('create', Store::class);

        $data = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'currency' => ['sometimes', 'string', 'max:8'],
            'timezone' => ['sometimes', 'string', 'max:64'],
            'parent_store_id' => ['nullable', 'uuid', 'exists:stores,id'],
        ]);

        $store = \Illuminate\Support\Facades\DB::transaction(function () use ($data, $request) {
            $store = Store::create([...$data, 'owner_user_id' => $request->user()->id]);

            \App\Models\StoreMember::create([
                'store_id' => $store->id,
                'user_id' => $request->user()->id,
                'role' => \App\Models\StoreMember::ROLE_ADMIN,
            ]);

            return $store;
        });

        return (new StoreResource($store))->response()->setStatusCode(201);
    }
}

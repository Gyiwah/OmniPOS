<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Device;
use App\Services\Sync\EntityResolver;
use App\Services\Sync\SyncService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * POST /api/sync/push
 * GET  /api/sync/pull
 * POST /api/sync/devices
 *
 * Store access is enforced by the store.access middleware, which publishes the
 * authorised store id as a request attribute. Never read store_id straight off
 * the request here — that value has not been checked against membership.
 */
class SyncController extends Controller
{
    public function __construct(
        private readonly SyncService $sync,
        private readonly EntityResolver $entities,
    ) {
    }

    /** Register or refresh this installation, and learn its sync cursor. */
    public function registerDevice(Request $request): JsonResponse
    {
        $storeId = $request->attributes->get('store_id');

        $data = $request->validate([
            'device_id' => ['required', 'uuid'],
            'platform' => ['required', 'string', 'max:40'],
            'terminal_label' => ['nullable', 'string', 'max:120'],
            'app_version' => ['nullable', 'string', 'max:40'],
        ]);

        $device = Device::firstOrNew(['id' => $data['device_id']]);

        if ($device->exists && $device->store_id !== $storeId) {
            return response()->json([
                'message' => 'This device is registered to a different store.',
            ], 409);
        }

        $device->forceFill([
            'id' => $data['device_id'],
            'store_id' => $storeId,
            'user_id' => $request->user()->id,
            'platform' => $data['platform'],
            'terminal_label' => $data['terminal_label'] ?? $device->terminal_label,
            'app_version' => $data['app_version'] ?? null,
            'last_seen_at' => now(),
        ])->save();

        return response()->json([
            'device' => $device->only(['id', 'store_id', 'terminal_label', 'last_pull_sequence']),
            'entities' => $this->entities->entities(),
        ]);
    }

    public function push(Request $request): JsonResponse
    {
        $storeId = $request->attributes->get('store_id');

        $data = $request->validate([
            'device_id' => ['nullable', 'uuid'],
            'operations' => ['required', 'array', 'min:1', 'max:500'],
            'operations.*.operation_id' => ['required', 'uuid'],
            'operations.*.entity' => ['required', 'string', Rule::in($this->entities->entities())],
            'operations.*.action' => ['required', Rule::in(['insert', 'upsert', 'update', 'delete'])],
            'operations.*.record_id' => ['required', 'uuid'],
            'operations.*.payload' => ['sometimes', 'array'],
        ]);

        $device = $this->resolveDevice($data['device_id'] ?? null, $storeId);

        $summary = $this->sync->push($storeId, $request->user(), $device, $data['operations']);

        // 200 even when some operations conflicted. Conflicts are per-operation
        // outcomes the client must reconcile individually, not a failure of the
        // request — an HTTP error would make clients retry the whole batch,
        // including the operations that succeeded.
        return response()->json($summary);
    }

    public function pull(Request $request): JsonResponse
    {
        $storeId = $request->attributes->get('store_id');

        $data = $request->validate([
            'cursor' => ['nullable', 'integer', 'min:0'],
            'limit' => ['nullable', 'integer', 'min:1', 'max:1000'],
            'device_id' => ['nullable', 'uuid'],
            'include_own' => ['nullable', 'boolean'],
        ]);

        $device = $this->resolveDevice($data['device_id'] ?? null, $storeId);

        return response()->json($this->sync->pull(
            storeId: $storeId,
            cursor: (int) ($data['cursor'] ?? 0),
            limit: (int) ($data['limit'] ?? 500),
            device: $device,
            includeOwn: (bool) ($data['include_own'] ?? false),
        ));
    }

    /**
     * A device id from another store is ignored rather than trusted, so a client
     * cannot attribute its writes to someone else's terminal.
     */
    private function resolveDevice(?string $deviceId, string $storeId): ?Device
    {
        if (! $deviceId) {
            return null;
        }

        return Device::where('store_id', $storeId)->find($deviceId);
    }
}

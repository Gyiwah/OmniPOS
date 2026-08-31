<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Api\Concerns\ScopesToStore;
use App\Http\Controllers\Controller;
use App\Http\Resources\OrderResource;
use App\Models\AuditLog;
use App\Models\Order;
use App\Services\CustomerLedger;
use App\Services\InventoryService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Orders are READ and ACTED ON here, but not created here.
 *
 * A sale is created by the client — mobile or web — and reaches the server
 * through POST /api/sync/push, which is idempotent on operation_id. Adding a
 * REST create would mean two implementations of "take money": two places
 * computing stock movements, two places writing payments, two places deciding
 * what a duplicate looks like. Divergence between them would show up as missing
 * revenue, which is the one class of bug this architecture is built to prevent.
 *
 * Voids and refunds do live here: they are online, deliberate, manager-level
 * corrections rather than till operations.
 */
class OrderController extends Controller
{
    use ScopesToStore;

    public function __construct(
        private readonly InventoryService $inventory,
        private readonly CustomerLedger $ledger,
    ) {
    }

    /**
     * GET /api/orders
     *
     * Query: search, status, customer_id, cashier_user_id, register_shift_id,
     *        from, to, unpaid, per_page
     *
     * Date filters run on client_created_at — when the sale happened at the till
     * — not created_at, which for an offline sale is whenever the device next
     * reconnected. Filtering on the wrong one moves a day's takings into the
     * wrong day.
     */
    public function index(Request $request): AnonymousResourceCollection
    {
        $query = Order::forStore($this->storeId($request))
            ->with(['customer:id,name', 'cashier:id,name'])
            ->withCount('items');

        if ($search = trim((string) $request->query('search', ''))) {
            $query->where(function ($q) use ($search) {
                $q->where('order_number', 'ilike', "%{$search}%")
                    ->orWhere('customer_name', 'ilike', "%{$search}%")
                    ->orWhere('customer_phone', 'ilike', "%{$search}%");
            });
        }

        foreach (['status', 'customer_id', 'cashier_user_id', 'register_shift_id'] as $field) {
            if ($value = $request->query($field)) {
                $query->where($field, $value);
            }
        }

        if ($from = $request->query('from')) {
            $query->where('client_created_at', '>=', $from);
        }
        if ($to = $request->query('to')) {
            $query->where('client_created_at', '<=', $to);
        }

        if ($request->boolean('unpaid')) {
            $query->whereColumn('amount_paid', '<', 'total');
        }

        return OrderResource::collection(
            $query->latest('client_created_at')->paginate($this->perPage($request))
        );
    }

    public function show(Request $request, string $order): OrderResource
    {
        return new OrderResource(
            $this->find($request, $order)->load(['items.returnItems', 'payments', 'customer', 'cashier'])
        );
    }

    /**
     * POST /api/orders/{order}/void
     *
     * Voiding returns the goods to stock through the ledger and reverses the
     * customer's balance. The order is never deleted: the receipt number stays
     * spoken for, and the audit trail keeps the fact that a sale was cancelled
     * and by whom.
     */
    public function void(Request $request, string $order): JsonResponse
    {
        $model = $this->find($request, $order);
        $this->authorize('void', $model);

        if ($model->status === 'voided') {
            return response()->json(['message' => 'This order is already voided.'], 422);
        }

        $data = $request->validate([
            'reason' => ['required', 'string', 'max:255'],
            'restock' => ['sometimes', 'boolean'],
        ]);

        $restock = $data['restock'] ?? true;
        $before = $model->only(['status', 'total', 'amount_paid']);

        DB::transaction(function () use ($model, $data, $restock, $request, $before) {
            if ($restock) {
                foreach ($model->items()->with('product')->get() as $item) {
                    if (! $item->product) {
                        continue;
                    }

                    $this->inventory->recordMovement(
                        movementId: (string) Str::uuid7(),
                        product: $item->product,
                        type: 'RETURN',
                        quantity: (float) $item->quantity,
                        reason: "Void of order {$model->order_number}",
                        user: $request->user(),
                        sourceType: 'order_void',
                        sourceId: $model->id,
                    );
                }
            }

            $model->forceFill([
                'status' => 'voided',
                'version' => $model->version + 1,
            ])->save();

            if ($model->customer) {
                $this->ledger->recompute($model->customer);
            }

            AuditLog::create([
                'store_id' => $model->store_id,
                'user_id' => $request->user()->id,
                'action' => 'order.voided',
                'entity_type' => 'order',
                'entity_id' => $model->id,
                'before' => $before,
                'after' => ['status' => 'voided', 'reason' => $data['reason'], 'restocked' => $restock],
                'ip_address' => $request->ip(),
                'user_agent' => $request->userAgent(),
            ]);
        });

        return response()->json([
            'order' => new OrderResource($model->refresh()->load('items')),
            'restocked' => $restock,
        ]);
    }

    /**
     * GET /api/orders/next-number
     *
     * The next receipt number that is actually free for this store today.
     *
     * A till generates its own numbers offline from what it knows locally. That
     * is fine until two tills are disconnected at once and both reach the same
     * number. When one of them is then asked to re-issue, deriving the next
     * number locally again is useless — local knowledge is exactly what was
     * wrong. It would collide on 0002, then 0003, once per attempt.
     *
     * Only the server sees every till's numbers, so re-issue asks here.
     */
    public function nextNumber(Request $request): JsonResponse
    {
        $storeId = $this->storeId($request);
        $prefix = 'OM-'.now()->format('Ymd').'-';

        // The suffix is zero-padded, so lexical max is also the numeric max.
        // That avoids casting inside SQL, where binding the substring offset is
        // fiddly and silently yielded null — which handed back a number that was
        // already taken.
        $highestNumber = Order::withTrashed()
            ->where('store_id', $storeId)
            ->where('order_number', 'like', $prefix.'%')
            ->max('order_number');

        $sequence = $highestNumber
            ? (int) substr($highestNumber, strlen($prefix))
            : 0;

        return response()->json([
            'order_number' => $prefix.str_pad((string) ($sequence + 1), 4, '0', STR_PAD_LEFT),
        ]);
    }

    /** GET /api/orders/{order}/receipt — everything a reprint needs, in one call. */
    public function receipt(Request $request, string $order): JsonResponse
    {
        $model = $this->find($request, $order)->load(['items', 'payments', 'customer', 'cashier', 'store']);

        return response()->json([
            'order' => new OrderResource($model),
            'store' => new \App\Http\Resources\StoreResource($model->store),
        ]);
    }

    private function find(Request $request, string $id): Order
    {
        return Order::forStore($this->storeId($request))->findOrFail($id);
    }
}

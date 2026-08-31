<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Api\Concerns\ScopesToStore;
use App\Http\Controllers\Controller;
use App\Http\Resources\OrderResource;
use App\Http\Resources\ReturnResource;
use App\Models\Order;
use App\Models\SaleReturn;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

/**
 * Returns are read here; they are created through the sync push, for the same
 * reason orders are — one implementation of the money path, not two.
 *
 * The eligibility endpoint is the useful part: it answers "how many of this can
 * this customer still bring back", which is the check that stops someone
 * returning three of an item they bought two of across separate visits.
 */
class ReturnController extends Controller
{
    use ScopesToStore;

    /** GET /api/returns — query: search, order_id, from, to */
    public function index(Request $request): AnonymousResourceCollection
    {
        $query = SaleReturn::forStore($this->storeId($request))->with(['order:id,order_number', 'items']);

        if ($orderId = $request->query('order_id')) {
            $query->where('order_id', $orderId);
        }

        if ($from = $request->query('from')) {
            $query->where('client_created_at', '>=', $from);
        }
        if ($to = $request->query('to')) {
            $query->where('client_created_at', '<=', $to);
        }

        if ($search = trim((string) $request->query('search', ''))) {
            $query->whereHas('order', fn ($q) => $q->where('order_number', 'ilike', "%{$search}%"));
        }

        return ReturnResource::collection(
            $query->latest('client_created_at')->paginate($this->perPage($request))
        );
    }

    public function show(Request $request, string $return): ReturnResource
    {
        return new ReturnResource(
            SaleReturn::forStore($this->storeId($request))->with(['items', 'order'])->findOrFail($return)
        );
    }

    /**
     * GET /api/returns/eligibility/{order}
     *
     * Per line: how many units were sold, how many have already come back, and
     * how many remain returnable. Computed from return_items rather than from a
     * counter on the line, so it stays correct however many separate returns
     * have been processed against the same sale.
     */
    public function eligibility(Request $request, string $order): JsonResponse
    {
        $model = Order::forStore($this->storeId($request))
            ->with(['items.returnItems'])
            ->findOrFail($order);

        $lines = $model->items->map(function ($item) {
            $returned = (int) $item->returnItems->sum('quantity');

            return [
                'order_item_id' => $item->id,
                'product_id' => $item->product_id,
                'product_name' => $item->product_name,
                'unit_price' => $item->unit_price,
                'quantity_sold' => (int) $item->quantity,
                'quantity_returned' => $returned,
                'quantity_eligible' => max(0, (int) $item->quantity - $returned),
            ];
        });

        return response()->json([
            'order' => new OrderResource($model),
            'lines' => $lines,
            'fully_returned' => $lines->every(fn ($l) => $l['quantity_eligible'] === 0),
            'refundable_total' => (string) $lines->reduce(
                fn ($carry, $l) => bcadd($carry, bcmul((string) $l['unit_price'], (string) $l['quantity_eligible'], 2), 2),
                '0.00'
            ),
        ]);
    }
}

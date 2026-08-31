<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Api\Concerns\ScopesToStore;
use App\Http\Controllers\Controller;
use App\Http\Resources\ProductBatchResource;
use App\Http\Resources\ProductResource;
use App\Http\Resources\StockMovementResource;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\StockMovement;
use App\Models\StoreMember;
use App\Services\InventoryService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

/**
 * Stock: the ledger, adjustments, batches, and the exception reports.
 *
 * Nothing here writes products.stock directly. Every quantity change goes
 * through InventoryService::recordMovement so the ledger stays the single
 * source of truth and concurrent offline sales cannot overwrite each other.
 */
class InventoryController extends Controller
{
    use ScopesToStore;

    public function __construct(private readonly InventoryService $inventory)
    {
    }

    /** GET /api/stock-movements — query: product_id, type, from, to */
    public function movements(Request $request): AnonymousResourceCollection
    {
        $query = StockMovement::forStore($this->storeId($request))->with('product:id,name');

        foreach (['product_id', 'type'] as $field) {
            if ($value = $request->query($field)) {
                $query->where($field, $value);
            }
        }

        if ($from = $request->query('from')) {
            $query->where('created_at', '>=', $from);
        }
        if ($to = $request->query('to')) {
            $query->where('created_at', '<=', $to);
        }

        return StockMovementResource::collection(
            $query->latest('created_at')->paginate($this->perPage($request))
        );
    }

    /**
     * POST /api/stock-movements
     *
     * Manual adjustments: stock takes, damages, expiries, goods received.
     *
     * quantity is signed — negative removes, positive adds. It is deliberately
     * not split into a direction plus a magnitude, because the ledger stores a
     * signed value and a translation layer is somewhere for a sign error to hide.
     */
    public function recordMovement(Request $request): JsonResponse
    {
        $storeId = $this->storeId($request);

        $allowed = $request->user()->hasStoreRole($storeId, [
            StoreMember::ROLE_ADMIN, StoreMember::ROLE_MANAGER, StoreMember::ROLE_CASHIER,
        ]);
        abort_unless($allowed, 403, 'Your role does not permit stock adjustments.');

        $data = $request->validate([
            'id' => ['sometimes', 'uuid'],
            'product_id' => [
                'required', 'uuid',
                Rule::exists('products', 'id')->where(fn ($q) => $q->where('store_id', $storeId)),
            ],
            'type' => ['required', Rule::in([
                'STOCK_IN', 'STOCK_OUT', 'ADJUSTMENT', 'DAMAGE', 'EXPIRED', 'AUDIT', 'TRANSFER_IN', 'TRANSFER_OUT',
            ])],
            'quantity' => ['required', 'numeric', 'not_in:0'],
            'reason' => ['required', 'string', 'max:255'],
            'notes' => ['nullable', 'string'],
            'batch_id' => ['nullable', 'uuid'],
        ]);

        $product = Product::forStore($storeId)->findOrFail($data['product_id']);

        $movement = $this->inventory->recordMovement(
            movementId: $data['id'] ?? (string) Str::uuid7(),
            product: $product,
            type: $data['type'],
            quantity: (float) $data['quantity'],
            reason: $data['reason'],
            user: $request->user(),
            batchId: $data['batch_id'] ?? null,
            notes: $data['notes'] ?? null,
        );

        return response()->json([
            'movement' => new StockMovementResource($movement),
            'product' => new ProductResource($product->refresh()),
        ], 201);
    }

    /**
     * POST /api/inventory/stock-take
     *
     * Reconcile counted quantities against the ledger. Each line states what was
     * physically counted; the difference is posted as an AUDIT movement so the
     * correction is explained rather than appearing as an unexplained jump.
     */
    public function stockTake(Request $request): JsonResponse
    {
        $storeId = $this->storeId($request);

        $allowed = $request->user()->hasStoreRole($storeId, [
            StoreMember::ROLE_ADMIN, StoreMember::ROLE_MANAGER,
        ]);
        abort_unless($allowed, 403, 'Only an admin or manager can run a stock take.');

        $data = $request->validate([
            'reference' => ['nullable', 'string', 'max:120'],
            'counts' => ['required', 'array', 'min:1'],
            'counts.*.product_id' => ['required', 'uuid'],
            'counts.*.counted' => ['required', 'numeric', 'min:0'],
        ]);

        $reference = $data['reference'] ?? 'Stock take '.now()->toDateString();
        $adjusted = [];

        DB::transaction(function () use ($data, $storeId, $request, $reference, &$adjusted) {
            foreach ($data['counts'] as $line) {
                $product = Product::forStore($storeId)->find($line['product_id']);
                if (! $product) {
                    continue;
                }

                $delta = round((float) $line['counted'] - (float) $product->stock, 2);
                if (abs($delta) < 0.005) {
                    continue;
                }

                $this->inventory->recordMovement(
                    movementId: (string) Str::uuid7(),
                    product: $product,
                    type: 'AUDIT',
                    quantity: $delta,
                    reason: $reference,
                    user: $request->user(),
                    sourceType: 'stock_take',
                    notes: sprintf('System showed %s, counted %s.', $product->stock, $line['counted']),
                );

                $adjusted[] = [
                    'product_id' => $product->id,
                    'name' => $product->name,
                    'was' => $product->stock,
                    'counted' => $line['counted'],
                    'delta' => $delta,
                ];
            }
        });

        return response()->json([
            'reference' => $reference,
            'adjusted_count' => count($adjusted),
            'adjustments' => $adjusted,
        ]);
    }

    /** GET /api/inventory/low-stock */
    public function lowStock(Request $request): AnonymousResourceCollection
    {
        return ProductResource::collection(
            Product::forStore($this->storeId($request))
                ->where('is_active', true)
                ->lowStock()
                ->orderBy('stock')
                ->paginate($this->perPage($request))
        );
    }

    /**
     * GET /api/inventory/oversold
     *
     * Products whose ledger has gone negative — two offline tills sold the same
     * last unit. Surfaced rather than prevented, because refusing the second
     * sync push would discard a sale that has already been receipted.
     */
    public function oversold(Request $request): AnonymousResourceCollection
    {
        return ProductResource::collection(
            $this->inventory->oversoldProducts($this->storeId($request))
        );
    }

    /** GET /api/inventory/batches — query: product_id, expiring_within, expired */
    public function batches(Request $request): AnonymousResourceCollection
    {
        $query = ProductBatch::forStore($this->storeId($request));

        if ($productId = $request->query('product_id')) {
            $query->where('product_id', $productId);
        }

        if ($days = $request->query('expiring_within')) {
            $query->whereNotNull('expiry_date')
                ->whereDate('expiry_date', '<=', now()->addDays((int) $days))
                ->whereDate('expiry_date', '>=', now());
        }

        if ($request->boolean('expired')) {
            $query->whereNotNull('expiry_date')->whereDate('expiry_date', '<', now());
        }

        return ProductBatchResource::collection(
            $query->orderBy('expiry_date')->paginate($this->perPage($request))
        );
    }

    /**
     * GET /api/inventory/valuation
     *
     * Stock at cost and at retail. Restricted to roles that may see cost prices,
     * since the figure discloses supplier pricing across the whole catalogue.
     */
    public function valuation(Request $request): JsonResponse
    {
        $storeId = $this->storeId($request);

        $allowed = $request->user()->hasStoreRole($storeId, [
            StoreMember::ROLE_ADMIN, StoreMember::ROLE_MANAGER,
        ]);
        abort_unless($allowed, 403, 'Only an admin or manager can view stock valuation.');

        $row = DB::table('products')
            ->where('store_id', $storeId)
            ->whereNull('deleted_at')
            ->selectRaw('
                count(*) as products,
                coalesce(sum(stock), 0) as units,
                coalesce(sum(stock * coalesce(cost_price, 0)), 0) as at_cost,
                coalesce(sum(stock * price), 0) as at_retail
            ')->first();

        return response()->json([
            'products' => (int) $row->products,
            'units' => (int) $row->units,
            'value_at_cost' => (string) $row->at_cost,
            'value_at_retail' => (string) $row->at_retail,
            'potential_margin' => bcsub((string) $row->at_retail, (string) $row->at_cost, 2),
        ]);
    }
}

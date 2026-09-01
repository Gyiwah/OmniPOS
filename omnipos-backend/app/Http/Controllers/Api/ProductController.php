<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Api\Concerns\ScopesToStore;
use App\Http\Controllers\Controller;
use App\Http\Requests\StoreProductRequest;
use App\Http\Requests\UpdateProductRequest;
use App\Http\Resources\ProductResource;
use App\Models\PriceHistory;
use App\Models\Product;
use App\Models\StoreMember;
use App\Services\InventoryService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;

class ProductController extends Controller
{
    use ScopesToStore;

    public function __construct(private readonly InventoryService $inventory)
    {
    }

    /**
     * GET /api/products
     *
     * Query: search, category_id, low_stock, expiring_within, active, sort, per_page
     */
    public function index(Request $request): AnonymousResourceCollection
    {
        $query = Product::forStore($this->storeId($request))->with('category');

        if ($search = trim((string) $request->query('search', ''))) {
            // Matches the trigram indexes on name and sku created in the
            // products migration, so this stays fast on a large catalogue.
            $query->where(function ($q) use ($search) {
                $q->where('name', 'ilike', "%{$search}%")
                    ->orWhere('sku', 'ilike', "%{$search}%")
                    ->orWhere('barcode', $search);
            });
        }

        if ($categoryId = $request->query('category_id')) {
            $query->where('category_id', $categoryId);
        }

        if ($request->boolean('low_stock')) {
            $query->lowStock();
        }

        if ($request->has('active')) {
            $query->where('is_active', $request->boolean('active'));
        }

        if ($days = $request->query('expiring_within')) {
            $query->whereNotNull('expiry_date')
                ->whereDate('expiry_date', '<=', now()->addDays((int) $days));
        }

        $sort = $request->query('sort', 'name');
        $query->orderBy(in_array($sort, ['name', 'sku', 'stock', 'price', 'updated_at'], true) ? $sort : 'name');

        return ProductResource::collection($query->paginate($this->perPage($request)));
    }

    /**
     * GET /api/products/{product}
     *
     * The product is resolved within the store rather than by id alone, so a
     * valid id belonging to another tenant returns 404 rather than data.
     */
    public function show(Request $request, string $product): ProductResource
    {
        return new ProductResource($this->find($request, $product)->load('category'));
    }

    /**
     * POST /api/products
     *
     * Opening stock is optional and, if given, enters through the ledger like
     * every other quantity — never as a bare column write.
     */
    public function store(StoreProductRequest $request): JsonResponse
    {
        $storeId = $this->storeId($request);
        $data = $request->validated();
        $openingStock = (float) ($data['stock'] ?? 0);
        unset($data['stock']);

        $product = DB::transaction(function () use ($data, $storeId, $openingStock, $request) {
            $product = Product::create([...$data, 'store_id' => $storeId, 'stock' => 0]);

            if ($openingStock !== 0.0) {
                $this->inventory->recordMovement(
                    movementId: (string) \Illuminate\Support\Str::uuid7(),
                    product: $product,
                    type: 'STOCK_IN',
                    quantity: $openingStock,
                    reason: 'Opening stock',
                    user: $request->user(),
                );
            }

            return $product;
        });

        return (new ProductResource($product->refresh()))->response()->setStatusCode(201);
    }

    /**
     * PATCH /api/products/{product}
     *
     * A price change writes a price_history row in the same transaction. Doing
     * it here rather than in a model observer keeps the "who changed it" visible
     * at the point of change.
     */
    public function update(UpdateProductRequest $request, string $product): ProductResource
    {
        $model = $this->find($request, $product);
        $this->authorize('update', $model);

        $data = $request->validated();

        // Quantity is never accepted here; it moves only through the ledger.
        // price_change_reason annotates the price_history row and is not a
        // product attribute, so it must not reach the model.
        unset($data['stock'], $data['price_change_reason']);

        $priceChanged = array_key_exists('price', $data)
            && bccomp((string) $data['price'], (string) $model->price, 2) !== 0;
        $costChanged = array_key_exists('cost_price', $data)
            && (string) $data['cost_price'] !== (string) $model->cost_price;

        DB::transaction(function () use ($model, $data, $priceChanged, $costChanged, $request) {
            if ($priceChanged || $costChanged) {
                PriceHistory::create([
                    'store_id' => $model->store_id,
                    'product_id' => $model->id,
                    'user_id' => $request->user()->id,
                    'old_sell_price' => $model->price,
                    'new_sell_price' => $data['price'] ?? $model->price,
                    'old_cost_price' => $model->cost_price,
                    'new_cost_price' => $data['cost_price'] ?? $model->cost_price,
                    'reason' => $request->input('price_change_reason'),
                ]);
            }

            $model->update($data);
        });

        return new ProductResource($model->refresh()->load('category'));
    }

    /**
     * DELETE /api/products/{product}
     *
     * Soft delete. Order lines snapshot their product details and hold a
     * nullable product_id, so historical receipts stay intact either way, but a
     * soft delete keeps the catalogue recoverable after a mistake.
     */
    public function destroy(Request $request, string $product): JsonResponse
    {
        $model = $this->find($request, $product);
        $this->authorize('delete', $model);

        $model->delete();

        return response()->json(['deleted' => true]);
    }

    /** GET /api/products/{product}/movements — the ledger behind the number. */
    public function movements(Request $request, string $product): AnonymousResourceCollection
    {
        $model = $this->find($request, $product);

        return \App\Http\Resources\StockMovementResource::collection(
            // Tie-broken on the id, which is a UUIDv7 and therefore ordered by
            // the millisecond it was minted. created_at alone has one-second
            // resolution here, so two movements in the same second came back in
            // arbitrary order — and a ledger read out of sequence shows running
            // balances that appear to contradict each other.
            $model->movements()->with('product')->latest('created_at')->latest('id')->paginate($this->perPage($request))
        );
    }

    /**
     * GET /api/products/{product}/price-history
     *
     * What this has been sold and bought for over time.
     *
     * Written through the sync queue since the price feature landed, but until
     * now there was no way to read it back — the mobile app showed only the
     * changes that device had made itself, which is exactly the wrong view when
     * the question is "who put the price up".
     *
     * Restricted to roles that may see cost, because the rows carry old and new
     * cost prices; that is the same boundary that hides cost_price on a product.
     */
    public function priceHistory(Request $request, string $product): JsonResponse
    {
        $storeId = $this->storeId($request);

        abort_unless(
            $request->user()->hasStoreRole($storeId, [StoreMember::ROLE_ADMIN, StoreMember::ROLE_MANAGER]),
            403,
            'Only an admin or manager can see price history.',
        );

        $model = $this->find($request, $product);

        $rows = PriceHistory::where('store_id', $storeId)
            ->where('product_id', $model->id)
            ->with('user:id,name')
            // Newest first, tie-broken on the id so two changes in the same
            // second still read in the order they happened.
            ->latest('client_created_at')
            ->latest('id')
            ->limit(100)
            ->get();

        return response()->json([
            'data' => $rows->map(fn (PriceHistory $r) => [
                'id' => $r->id,
                'old_sell_price' => $r->old_sell_price,
                'new_sell_price' => $r->new_sell_price,
                'old_cost_price' => $r->old_cost_price,
                'new_cost_price' => $r->new_cost_price,
                'reason' => $r->reason,
                'changed_by' => $r->user?->name,
                'at' => ($r->client_created_at ?? $r->created_at)?->toIso8601String(),
            ]),
        ]);
    }

    private function find(Request $request, string $id): Product
    {
        return Product::forStore($this->storeId($request))->findOrFail($id);
    }
}

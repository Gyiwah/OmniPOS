<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Api\Concerns\ScopesToStore;
use App\Http\Controllers\Controller;
use App\Http\Resources\CategoryResource;
use App\Models\Category;
use App\Models\StoreMember;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Validation\Rule;

/** Product grouping for the web POS category rail. */
class CategoryController extends Controller
{
    use ScopesToStore;

    public function index(Request $request): AnonymousResourceCollection
    {
        return CategoryResource::collection(
            Category::forStore($this->storeId($request))
                ->withCount('products')
                ->orderBy('position')->orderBy('name')
                ->get()
        );
    }

    public function store(Request $request): JsonResponse
    {
        $this->assertManages($request);
        $storeId = $this->storeId($request);

        $data = $request->validate([
            'id' => ['sometimes', 'uuid', Rule::unique('categories', 'id')],
            'name' => [
                'required', 'string', 'max:120',
                Rule::unique('categories', 'name')->where(fn ($q) => $q->where('store_id', $storeId)),
            ],
            'parent_id' => [
                'nullable', 'uuid',
                Rule::exists('categories', 'id')->where(fn ($q) => $q->where('store_id', $storeId)),
            ],
            'color' => ['nullable', 'string', 'max:16'],
            'position' => ['sometimes', 'integer', 'min:0'],
        ]);

        $category = Category::create([...$data, 'store_id' => $storeId]);

        return (new CategoryResource($category))->response()->setStatusCode(201);
    }

    public function update(Request $request, string $category): CategoryResource
    {
        $this->assertManages($request);
        $storeId = $this->storeId($request);
        $model = Category::forStore($storeId)->findOrFail($category);

        $model->update($request->validate([
            'name' => [
                'sometimes', 'string', 'max:120',
                Rule::unique('categories', 'name')
                    ->where(fn ($q) => $q->where('store_id', $storeId))->ignore($model->id),
            ],
            'parent_id' => ['nullable', 'uuid', Rule::notIn([$model->id])],
            'color' => ['nullable', 'string', 'max:16'],
            'position' => ['sometimes', 'integer', 'min:0'],
        ]));

        return new CategoryResource($model->refresh());
    }

    /**
     * DELETE /api/categories/{category}
     *
     * Products keep existing and fall back to uncategorised — the FK is
     * nullOnDelete, so removing a grouping never removes stock.
     */
    public function destroy(Request $request, string $category): JsonResponse
    {
        $this->assertManages($request);

        Category::forStore($this->storeId($request))->findOrFail($category)->delete();

        return response()->json(['deleted' => true]);
    }

    private function assertManages(Request $request): void
    {
        $allowed = $request->user()->hasStoreRole($this->storeId($request), [
            StoreMember::ROLE_ADMIN, StoreMember::ROLE_MANAGER,
        ]);

        abort_unless($allowed, 403, 'Only an admin or manager can manage categories.');
    }
}

<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Api\Concerns\ScopesToStore;
use App\Http\Controllers\Controller;
use App\Models\Product;
use App\Models\Store;
use App\Models\StoreMember;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Product images and store logos. Replaces the Supabase storage bucket.
 *
 * Objects are stored under {store_id}/... exactly as they were in Supabase, so
 * paths already held in products.image_url and stores.logo_url keep working
 * after the migration.
 *
 * Reads go through this controller rather than a public URL. The bucket was
 * protected by RLS on storage.objects; the equivalent here is checking store
 * membership on every read, because a public disk would let anyone with a path
 * enumerate another shop's catalogue.
 */
class MediaController extends Controller
{
    use ScopesToStore;

    private const MAX_BYTES = 8 * 1024 * 1024;

    private const ALLOWED = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic'];

    /**
     * POST /api/media
     *
     * multipart: file, kind=product|logo, product_id (when kind=product)
     */
    public function store(Request $request): JsonResponse
    {
        $storeId = $this->storeId($request);

        $allowed = $request->user()->hasStoreRole($storeId, [
            StoreMember::ROLE_ADMIN,
            StoreMember::ROLE_MANAGER,
        ]);
        abort_unless($allowed, 403, 'Only an admin or manager can upload images.');

        $data = $request->validate([
            'file' => ['required', 'file', 'max:'.(self::MAX_BYTES / 1024), 'mimes:jpg,jpeg,png,webp,gif,heic'],
            'kind' => ['required', 'in:product,logo'],
            'product_id' => ['required_if:kind,product', 'uuid'],
        ]);

        $file = $request->file('file');
        $extension = strtolower($file->getClientOriginalExtension() ?: $file->guessExtension() ?: 'jpg');
        if (! in_array($extension, self::ALLOWED, true)) {
            $extension = 'jpg';
        }

        if ($data['kind'] === 'product') {
            $existing = Product::withTrashed()->find($data['product_id']);
            if ($existing && $existing->store_id !== $storeId) {
                abort(404, 'Product not found.');
            }

            $product = $existing;
            if (! $product) {
                $product = Product::create([
                    'id' => $data['product_id'],
                    'store_id' => $storeId,
                    'name' => 'New Product',
                    'sku' => 'SKU-'.substr($data['product_id'], 0, 8),
                    'price' => 0.00,
                    'stock' => 0,
                    'is_active' => true,
                ]);
            }
            // Deterministic path: re-uploading replaces the image rather than
            // accumulating orphans nothing will ever clean up.
            $path = "{$storeId}/products/{$product->id}.{$extension}";
        } else {
            $path = "{$storeId}/branding/logo.{$extension}";
        }

        Storage::disk($this->disk())->put($path, file_get_contents($file->getRealPath()));

        if ($data['kind'] === 'product') {
            // Keep the catalogue pointing at the object. The upload is shared
            // by web and mobile, so neither client should have to persist this
            // separately after a successful upload.
            Product::whereKey($data['product_id'])
                ->where('store_id', $storeId)
                ->update(['image_url' => $path]);
        }

        return response()->json([
            'path' => $path,
            'url' => $this->urlFor($path),
        ], 201);
    }

    /**
     * GET /api/media/{path}
     *
     * Streams the object after confirming the caller belongs to the store whose
     * id prefixes the path. That prefix is the authorisation boundary, so it is
     * parsed and checked rather than trusted.
     */
    public function show(Request $request, string $path): StreamedResponse
    {
        $path = ltrim($path, '/');

        // Refuse traversal outright rather than relying on the disk to resolve
        // it safely.
        abort_if(str_contains($path, '..'), 400, 'Invalid path.');

        $owningStore = Str::before($path, '/');
        abort_unless(Str::isUuid($owningStore), 404, 'Not found.');

        $user = $request->user();
        $user->loadMissing('memberships');

        abort_unless(
            $user->is_super_admin || $user->isMemberOf($owningStore),
            404,
            'Not found.',
        );

        $disk = Storage::disk($this->disk());
        abort_unless($disk->exists($path), 404, 'Not found.');

        return $disk->response($path, null, [
            // Private: an image behind a membership check must not be cached by
            // an intermediary that has no idea who asked for it.
            'Cache-Control' => 'private, max-age=3600',
        ]);
    }

    /** DELETE /api/media/{path} */
    public function destroy(Request $request, string $path): JsonResponse
    {
        $storeId = $this->storeId($request);
        $path = ltrim($path, '/');

        abort_if(str_contains($path, '..'), 400, 'Invalid path.');
        abort_unless(Str::startsWith($path, "{$storeId}/"), 404, 'Not found.');

        abort_unless(
            $request->user()->hasStoreRole($storeId, [StoreMember::ROLE_ADMIN, StoreMember::ROLE_MANAGER]),
            403,
            'Only an admin or manager can delete images.',
        );

        Storage::disk($this->disk())->delete($path);

        return response()->json(['deleted' => true]);
    }

    /**
     * Where objects live. Local disk in development, S3 in production — the
     * store-scoped path layout is identical either way, so moving between them
     * needs no data rewrite.
     */
    private function disk(): string
    {
        return config('omnipos.media.disk', 'local');
    }

    private function urlFor(string $path): string
    {
        return url('/api/media/'.$path);
    }

    /**
     * POST /api/media/store-logo — convenience wrapper that also records the
     * path on the store, so a caller does not have to make two requests and
     * risk the second failing.
     */
    public function storeLogo(Request $request): JsonResponse
    {
        $response = $this->store($request->merge(['kind' => 'logo']));
        $path = $response->getData(true)['path'];

        Store::whereKey($this->storeId($request))->update(['logo_url' => $path]);

        return $response;
    }
}

<?php

namespace App\Http\Resources;

use App\Models\StoreMember;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin \App\Models\Product
 */
class ProductResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'store_id' => $this->store_id,
            'category_id' => $this->category_id,
            'name' => $this->name,
            'sku' => $this->sku,
            'barcode' => $this->barcode,
            'price' => $this->price,
            'stock' => $this->stock,
            'reorder_level' => $this->reorder_level,
            'low_stock' => $this->stock <= $this->reorder_level,
            'image_url' => $this->image_url,
            'tags' => $this->tags ?? [],
            'expiry_date' => $this->expiry_date?->toDateString(),
            'is_active' => $this->is_active,
            'created_at' => $this->created_at?->toIso8601String(),
            'updated_at' => $this->updated_at?->toIso8601String(),

            // Cost and margin are commercially sensitive: a cashier who can read
            // them can tell a competitor what the shop pays its suppliers. The
            // mobile plan gates this behind a manager PIN; the API gates it by
            // role, and the field is omitted entirely rather than nulled so its
            // absence is unambiguous.
            $this->mergeWhen($this->callerMaySeeCost($request), fn () => [
                'cost_price' => $this->cost_price,
                'margin' => $this->margin(),
            ]),

            'category' => new CategoryResource($this->whenLoaded('category')),
        ];
    }

    private function callerMaySeeCost(Request $request): bool
    {
        $role = $request->attributes->get('store_role');

        return in_array($role, [StoreMember::ROLE_ADMIN, StoreMember::ROLE_MANAGER, 'super_admin'], true);
    }

    private function margin(): ?string
    {
        if ($this->cost_price === null || bccomp((string) $this->price, '0', 2) !== 1) {
            return null;
        }

        return bcdiv(
            bcmul(bcsub((string) $this->price, (string) $this->cost_price, 2), '100', 2),
            (string) $this->price,
            2
        );
    }
}

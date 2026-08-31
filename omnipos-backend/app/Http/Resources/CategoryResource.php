<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin \App\Models\Category
 */
class CategoryResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'store_id' => $this->store_id,
            'parent_id' => $this->parent_id,
            'name' => $this->name,
            'color' => $this->color,
            'position' => $this->position,
            'products_count' => $this->whenCounted('products'),
        ];
    }
}

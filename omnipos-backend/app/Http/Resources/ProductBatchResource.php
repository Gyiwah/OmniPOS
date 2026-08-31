<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin \App\Models\ProductBatch
 */
class ProductBatchResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'store_id' => $this->store_id,
            'product_id' => $this->product_id,
            'batch_number' => $this->batch_number,
            'quantity' => $this->quantity,
            'cost_price' => $this->cost_price,
            'expiry_date' => $this->expiry_date?->toDateString(),
            'days_to_expiry' => $this->expiry_date
                ? (int) now()->startOfDay()->diffInDays($this->expiry_date, false)
                : null,
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}

<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin \App\Models\SaleReturn
 */
class ReturnResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'store_id' => $this->store_id,
            'order_id' => $this->order_id,
            'order_number' => $this->whenLoaded('order', fn () => $this->order?->order_number),
            'reason' => $this->reason,
            'amount' => $this->amount,
            'refund_method' => $this->refund_method,
            'processed_by_user_id' => $this->processed_by_user_id,
            'client_created_at' => $this->client_created_at?->toIso8601String(),
            'created_at' => $this->created_at?->toIso8601String(),
            'items' => ReturnItemResource::collection($this->whenLoaded('items')),
        ];
    }
}

<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin \App\Models\Customer
 */
class CustomerResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'store_id' => $this->store_id,
            'name' => $this->name,
            'phone' => $this->phone,
            'email' => $this->email,
            'notes' => $this->notes,

            // Server-maintained, derived from orders and payments. Clients read
            // these; they never write them.
            'total_spend' => $this->total_spend,
            'outstanding_balance' => $this->outstanding_balance,
            'has_debt' => bccomp((string) $this->outstanding_balance, '0', 2) === 1,

            'created_at' => $this->created_at?->toIso8601String(),
            'updated_at' => $this->updated_at?->toIso8601String(),

            'orders' => OrderResource::collection($this->whenLoaded('orders')),
            'orders_count' => $this->whenCounted('orders'),
        ];
    }
}

<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin \App\Models\Payment
 */
class PaymentResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'order_id' => $this->order_id,
            'customer_id' => $this->customer_id,
            'register_shift_id' => $this->register_shift_id,
            'method' => $this->method,
            'amount' => $this->amount,
            'reference' => $this->reference,
            'notes' => $this->notes,
            'received_by_user_id' => $this->received_by_user_id,
            'client_created_at' => $this->client_created_at?->toIso8601String(),
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}

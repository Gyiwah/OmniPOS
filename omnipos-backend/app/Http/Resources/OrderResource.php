<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin \App\Models\Order
 */
class OrderResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'store_id' => $this->store_id,
            'order_number' => $this->order_number,
            'status' => $this->status,

            'subtotal' => $this->subtotal,
            'tax' => $this->tax,
            'discount' => $this->discount,
            'total' => $this->total,
            'amount_paid' => $this->amount_paid,
            'change_due' => $this->change_due,
            'outstanding' => $this->outstanding(),
            'payment_method' => $this->payment_method,

            'customer_id' => $this->customer_id,
            'customer_name' => $this->customer_name ?? $this->whenLoaded('customer', fn () => $this->customer?->name),
            'customer_phone' => $this->customer_phone,

            'cashier_user_id' => $this->cashier_user_id,
            'cashier_name' => $this->whenLoaded('cashier', fn () => $this->cashier?->name),
            'register_shift_id' => $this->register_shift_id,
            'device_id' => $this->device_id,

            // When the sale happened on the till. For anything imported from
            // Supabase this equals created_at, because the device time was never
            // recorded there. Report on this field, not created_at.
            'client_created_at' => $this->client_created_at?->toIso8601String(),
            'created_at' => $this->created_at?->toIso8601String(),

            'items' => OrderItemResource::collection($this->whenLoaded('items')),
            'payments' => PaymentResource::collection($this->whenLoaded('payments')),
            'items_count' => $this->whenCounted('items'),
        ];
    }
}

<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin \App\Models\OrderItem
 */
class OrderItemResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'order_id' => $this->order_id,
            'product_id' => $this->product_id,
            // Snapshotted at time of sale so a reprinted receipt matches the one
            // the customer was handed, even after the product is renamed.
            'product_name' => $this->product_name,
            'sku' => $this->sku,
            'barcode' => $this->barcode,
            'unit_price' => $this->unit_price,
            'quantity' => $this->quantity,
            'line_total' => $this->line_total,
            'returned_quantity' => $this->whenLoaded('returnItems', fn () => $this->returnedQuantity()),
        ];
    }
}

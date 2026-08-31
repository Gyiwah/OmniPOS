<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin \App\Models\RegisterShift
 */
class RegisterShiftResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'store_id' => $this->store_id,
            'cashier_user_id' => $this->cashier_user_id,
            'cashier_name' => $this->whenLoaded('cashier', fn () => $this->cashier?->name),
            'device_id' => $this->device_id,
            'status' => $this->status,
            'opened_at' => $this->opened_at?->toIso8601String(),
            'closed_at' => $this->closed_at?->toIso8601String(),
            'opening_float' => $this->opening_float,
            'cash_sales' => $this->cash_sales,
            'cash_in' => $this->cash_in,
            'cash_out' => $this->cash_out,
            // Derived from the payments ledger, never from a client figure.
            'expected_cash' => $this->expected_cash,
            'actual_cash' => $this->actual_cash,
            'discrepancy' => $this->discrepancy,
            'movements' => $this->movements_json ?? [],
            'notes' => $this->notes,
        ];
    }
}

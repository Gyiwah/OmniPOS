<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin \App\Models\StoreInvite
 */
class StoreInviteResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'store_id' => $this->store_id,
            'email' => $this->email,
            'role' => $this->role,
            'status' => $this->status,
            'expires_at' => $this->expires_at?->toIso8601String(),
            'created_at' => $this->created_at?->toIso8601String(),
            // token is deliberately absent: it is a bearer secret belonging to
            // the invited person, not information for the staff list.
        ];
    }
}

<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin \App\Models\StoreMember
 */
class StoreMemberResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'store_id' => $this->store_id,
            'user_id' => $this->user_id,
            'role' => $this->role,
            'name' => $this->whenLoaded('user', fn () => $this->user?->name),
            'email' => $this->whenLoaded('user', fn () => $this->user?->email),
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}

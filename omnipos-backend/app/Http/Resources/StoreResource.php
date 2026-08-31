<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin \App\Models\Store
 */
class StoreResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'parent_store_id' => $this->parent_store_id,
            'name' => $this->name,
            'email' => $this->email,
            'logo_url' => $this->logo_url,
            'currency' => $this->currency,
            'timezone' => $this->timezone,
            'language' => $this->language,
            'tax_profile' => $this->tax_profile,
            'tax_rate' => $this->tax_rate,
            'vat_rate' => $this->vat_rate,
            'service_rate' => $this->service_rate,
            'app_mode_dark' => $this->app_mode_dark,
            'is_branch' => $this->parent_store_id !== null,
            'branches' => StoreResource::collection($this->whenLoaded('branches')),
        ];
    }
}

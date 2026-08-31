<?php

namespace App\Http\Requests;

use App\Models\StoreMember;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreProductRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()?->hasStoreRole(
            (string) $this->attributes->get('store_id'),
            [StoreMember::ROLE_ADMIN, StoreMember::ROLE_MANAGER]
        ) ?? false;
    }

    public function rules(): array
    {
        $storeId = (string) $this->attributes->get('store_id');

        return [
            // Clients may supply their own UUID so an offline-created product
            // keeps one identity everywhere.
            'id' => ['sometimes', 'uuid', Rule::unique('products', 'id')],
            'name' => ['required', 'string', 'max:255'],
            'sku' => [
                'required', 'string', 'max:100',
                // SKU is unique per store, not globally.
                Rule::unique('products', 'sku')->where(fn ($q) => $q->where('store_id', $storeId)),
            ],
            'barcode' => ['nullable', 'string', 'max:100'],
            'price' => ['required', 'numeric', 'min:0'],
            'cost_price' => ['nullable', 'numeric', 'min:0'],
            'stock' => ['sometimes', 'numeric'],
            'reorder_level' => ['sometimes', 'integer', 'min:0'],
            'category_id' => [
                'nullable', 'uuid',
                Rule::exists('categories', 'id')->where(fn ($q) => $q->where('store_id', $storeId)),
            ],
            'image_url' => ['nullable', 'string', 'max:2048'],
            'tags' => ['sometimes', 'array'],
            'tags.*' => ['string', 'max:50'],
            'expiry_date' => ['nullable', 'date'],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }
}

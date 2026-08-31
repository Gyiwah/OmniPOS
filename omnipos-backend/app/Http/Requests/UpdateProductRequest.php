<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateProductRequest extends FormRequest
{
    /** Authorisation is done by the controller against ProductPolicy::update. */
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        $storeId = (string) $this->attributes->get('store_id');
        $productId = $this->route('product');

        return [
            'name' => ['sometimes', 'string', 'max:255'],
            'sku' => [
                'sometimes', 'string', 'max:100',
                Rule::unique('products', 'sku')
                    ->where(fn ($q) => $q->where('store_id', $storeId))
                    ->ignore($productId),
            ],
            'barcode' => ['nullable', 'string', 'max:100'],
            'price' => ['sometimes', 'numeric', 'min:0'],
            'cost_price' => ['nullable', 'numeric', 'min:0'],
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
            'price_change_reason' => ['nullable', 'string', 'max:255'],
        ];
    }
}

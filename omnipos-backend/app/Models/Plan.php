<?php

namespace App\Models;

use App\Models\Concerns\HasClientMintedUuid;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Plan extends Model
{
    use HasClientMintedUuid;

    protected $fillable = ['name', 'slug', 'description', 'monthly_price', 'limits', 'platform_status'];

    protected function casts(): array
    {
        return ['monthly_price' => 'decimal:2', 'limits' => 'array'];
    }

    public function subscriptions(): HasMany
    {
        return $this->hasMany(Subscription::class);
    }
}
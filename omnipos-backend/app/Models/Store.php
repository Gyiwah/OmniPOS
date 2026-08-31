<?php

namespace App\Models;

use App\Models\Concerns\HasClientMintedUuid;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Store extends Model
{
    use HasClientMintedUuid;
    use SoftDeletes;

    protected $fillable = [
        'parent_store_id',
        'owner_user_id',
        'name',
        'email',
        'logo_url',
        'tax_profile',
        'currency',
        'timezone',
        'language',
        'app_mode_dark',
        'tax_rate',
        'vat_rate',
        'service_rate',
    ];

    protected function casts(): array
    {
        return [
            'app_mode_dark' => 'boolean',
            'tax_rate' => 'decimal:2',
            'vat_rate' => 'decimal:2',
            'service_rate' => 'decimal:2',
        ];
    }

    public function parent(): BelongsTo
    {
        return $this->belongsTo(self::class, 'parent_store_id');
    }

    public function branches(): HasMany
    {
        return $this->hasMany(self::class, 'parent_store_id');
    }

    public function owner(): BelongsTo
    {
        return $this->belongsTo(User::class, 'owner_user_id');
    }

    public function members(): HasMany
    {
        return $this->hasMany(StoreMember::class);
    }

    public function users(): BelongsToMany
    {
        return $this->belongsToMany(User::class, 'store_members')
            ->withPivot('role')
            ->withTimestamps();
    }

    public function products(): HasMany
    {
        return $this->hasMany(Product::class);
    }

    public function customers(): HasMany
    {
        return $this->hasMany(Customer::class);
    }

    public function orders(): HasMany
    {
        return $this->hasMany(Order::class);
    }

    /** This store plus every branch beneath it, for roll-up reporting. */
    public function scopeWithBranchIds($query, string $storeId)
    {
        return $query->where('id', $storeId)->orWhere('parent_store_id', $storeId);
    }
}

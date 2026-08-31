<?php

namespace App\Models\Concerns;

use App\Models\Store;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Every store-scoped model uses this.
 *
 * Supabase enforced tenant isolation in the database with RLS, so a forgotten
 * WHERE clause was still safe. Laravel has no such backstop: an unscoped query
 * returns every store's rows. `forStore()` is the single scoping helper, and
 * controllers are expected to start from it rather than from the bare model.
 */
trait BelongsToStore
{
    public function store(): BelongsTo
    {
        return $this->belongsTo(Store::class);
    }

    public function scopeForStore(Builder $query, string $storeId): Builder
    {
        return $query->where($this->getTable().'.store_id', $storeId);
    }
}

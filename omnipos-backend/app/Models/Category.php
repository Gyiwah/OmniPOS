<?php

namespace App\Models;

use App\Models\Concerns\BelongsToStore;
use App\Models\Concerns\HasClientMintedUuid;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/** Product grouping for the web POS category rail. */
class Category extends Model
{
    use BelongsToStore;
    use HasClientMintedUuid;
    use SoftDeletes;

    /**
     * `id` is fillable because clients mint it.
     *
     * CategoryController accepts an optional client-supplied id and passes it
     * straight to create().
     * Without it that throws, and creating a record fails while updating an
     * existing one succeeds — a gap no test that only edits existing rows can
     * find. See ClientMintedIdTest, which now pins this for every such model.
     */
    protected $fillable = [
        'id',
        'store_id',
        'parent_id',
        'name',
        'color',
        'position',
    ];

    protected function casts(): array
    {
        return [
            'position' => 'integer',
        ];
    }

    public function parent(): BelongsTo
    {
        return $this->belongsTo(self::class, 'parent_id');
    }

    public function children(): HasMany
    {
        return $this->hasMany(self::class, 'parent_id');
    }

    public function products(): HasMany
    {
        return $this->hasMany(Product::class);
    }
}

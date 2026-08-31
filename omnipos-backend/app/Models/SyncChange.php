<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * The changefeed clients pull. `sequence` is the cursor.
 *
 * Replaces both Supabase Realtime and the never-populated public.sync_log.
 */
class SyncChange extends Model
{
    public const UPDATED_AT = null;

    protected $primaryKey = 'sequence';

    protected $fillable = [
        'store_id',
        'entity',
        'record_id',
        'action',
        'payload',
        'origin_device_id',
    ];

    protected function casts(): array
    {
        return [
            'payload' => 'array',
            'created_at' => 'datetime',
        ];
    }

    public function store(): BelongsTo
    {
        return $this->belongsTo(Store::class);
    }
}

<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Idempotency ledger for sync pushes. One row per operation_id the server has
 * ever seen; a repeat is answered from `result` rather than re-applied.
 *
 * Auto-incrementing id, unlike the domain models: these rows are server-owned
 * bookkeeping and are never created by a client.
 */
class SyncOperation extends Model
{
    public const STATUS_APPLIED = 'applied';
    public const STATUS_DUPLICATE = 'duplicate';
    public const STATUS_CONFLICT = 'conflict';
    public const STATUS_FAILED = 'failed';

    protected $fillable = [
        'operation_id',
        'store_id',
        'device_id',
        'user_id',
        'entity',
        'record_id',
        'action',
        'status',
        'result',
        'error',
        'client_created_at',
        'processed_at',
    ];

    protected function casts(): array
    {
        return [
            'result' => 'array',
            'client_created_at' => 'datetime',
            'processed_at' => 'datetime',
        ];
    }

    public function store(): BelongsTo
    {
        return $this->belongsTo(Store::class);
    }

    public function device(): BelongsTo
    {
        return $this->belongsTo(Device::class);
    }
}

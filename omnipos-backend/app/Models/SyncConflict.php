<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * An operation the server could not apply as sent. Recorded rather than
 * discarded: a rejected sale that vanishes silently is worse than one a manager
 * has to reconcile.
 */
class SyncConflict extends Model
{
    protected $fillable = [
        'operation_id',
        'store_id',
        'device_id',
        'entity',
        'record_id',
        'reason',
        'client_payload',
        'server_state',
        'resolution',
        'resolved_by_user_id',
        'resolved_at',
    ];

    protected function casts(): array
    {
        return [
            'client_payload' => 'array',
            'server_state' => 'array',
            'resolved_at' => 'datetime',
        ];
    }

    public function store(): BelongsTo
    {
        return $this->belongsTo(Store::class);
    }

    public function scopePending($query)
    {
        return $query->where('resolution', 'pending');
    }
}

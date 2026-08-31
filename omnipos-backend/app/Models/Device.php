<?php

namespace App\Models;

use App\Models\Concerns\BelongsToStore;
use App\Models\Concerns\HasClientMintedUuid;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A registered client installation. Gives sync operations an origin so a device
 * can filter its own changes out of its pull, and so audit rows can name the
 * terminal a transaction came from.
 */
class Device extends Model
{
    use BelongsToStore;
    use HasClientMintedUuid;

    protected $fillable = [
        'id',
        'store_id',
        'user_id',
        'platform',
        'terminal_label',
        'app_version',
        'last_pull_sequence',
        'last_seen_at',
    ];

    protected function casts(): array
    {
        return [
            'last_pull_sequence' => 'integer',
            'last_seen_at' => 'datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}

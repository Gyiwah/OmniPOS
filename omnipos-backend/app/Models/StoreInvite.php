<?php

namespace App\Models;

use App\Models\Concerns\BelongsToStore;
use App\Models\Concerns\HasClientMintedUuid;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class StoreInvite extends Model
{
    use BelongsToStore;
    use HasClientMintedUuid;

    protected $fillable = [
        'store_id',
        'email',
        'role',
        'status',
        'invited_by',
        'accepted_user_id',
        'token',
        'expires_at',
    ];

    protected $hidden = ['token'];

    protected function casts(): array
    {
        return [
            'expires_at' => 'datetime',
        ];
    }

    public function invitedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'invited_by');
    }

    public function isPending(): bool
    {
        return $this->status === 'pending' && $this->expires_at->isFuture();
    }

    public function scopePending($query)
    {
        return $query->where('status', 'pending')->where('expires_at', '>', now());
    }
}

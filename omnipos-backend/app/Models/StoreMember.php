<?php

namespace App\Models;

use App\Models\Concerns\HasClientMintedUuid;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * The tenancy boundary. Replaces the Supabase is_store_member() /
 * has_store_role() RLS helper functions.
 */
class StoreMember extends Model
{
    use HasClientMintedUuid;

    public const ROLE_ADMIN = 'admin';
    public const ROLE_MANAGER = 'manager';
    public const ROLE_CASHIER = 'cashier';

    public const ROLES = [self::ROLE_ADMIN, self::ROLE_MANAGER, self::ROLE_CASHIER];

    protected $fillable = [
        'store_id',
        'user_id',
        'role',
        'invited_by',
    ];

    public function store(): BelongsTo
    {
        return $this->belongsTo(Store::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}

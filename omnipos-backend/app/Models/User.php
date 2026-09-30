<?php

namespace App\Models;

use App\Models\Concerns\HasClientMintedUuid;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

/**
 * Replaces Supabase auth.users + profiles.
 *
 * is_super_admin is a platform-operator flag. Store-level authority is NOT here:
 * it lives in store_members, because the same person can be an admin of one store
 * and a cashier in another.
 */
class User extends Authenticatable
{
    use HasApiTokens;
    use HasClientMintedUuid;
    use Notifiable;
    use SoftDeletes;

    protected $fillable = [
        'name',
        'email',
        'password',
        'avatar_url',
        'is_super_admin',
    ];

    protected $hidden = [
        'password',
        'remember_token',
    ];

    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
            'is_super_admin' => 'boolean',
        ];
    }

    public function memberships(): HasMany
    {
        return $this->hasMany(StoreMember::class);
    }

    public function stores(): BelongsToMany
    {
        return $this->belongsToMany(Store::class, 'store_members')
            ->withPivot('role')
            ->withTimestamps();
    }

    public function ownedStores(): HasMany
    {
        return $this->hasMany(Store::class, 'owner_user_id');
    }

    /**
     * Role held in the given store, or null when not a member.
     *
     * Uses the loaded relation when there is one and queries otherwise. The
     * explicit check matters because AppServiceProvider enables
     * preventLazyLoading in development: reading $this->memberships on a model
     * that was not eager-loaded would throw, and this method sits on the
     * authorisation path where a crash is the worst possible failure mode.
     */
    public function roleIn(string $storeId): ?string
    {
        $directRole = null;
        if ($this->relationLoaded('memberships')) {
            $directRole = $this->memberships->firstWhere('store_id', $storeId)?->role;
        } else {
            $directRole = $this->memberships()->where('store_id', $storeId)->value('role');
        }

        if ($directRole === StoreMember::ROLE_ADMIN) {
            return StoreMember::ROLE_ADMIN;
        }

        // The store admin of the parent store should always be the admin of all the branches
        $store = Store::find($storeId);
        if ($store?->parent_store_id !== null) {
            $parentRole = $this->roleIn($store->parent_store_id);
            if ($parentRole === StoreMember::ROLE_ADMIN) {
                return StoreMember::ROLE_ADMIN;
            }
        }

        return $directRole;
    }

    public function isMemberOf(string $storeId): bool
    {
        return $this->roleIn($storeId) !== null;
    }

    /**
     * Super admins pass every store-role check. This is the single place that
     * privilege is granted, so it stays auditable.
     */
    public function hasStoreRole(string $storeId, array $roles): bool
    {
        if ($this->is_super_admin) {
            return true;
        }

        $role = $this->roleIn($storeId);

        return $role !== null && in_array($role, $roles, true);
    }
}

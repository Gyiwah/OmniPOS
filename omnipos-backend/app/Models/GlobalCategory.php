<?php

namespace App\Models;

use App\Models\Concerns\HasClientMintedUuid;
use Illuminate\Database\Eloquent\Model;

class GlobalCategory extends Model
{
    use HasClientMintedUuid;

    protected $table = 'global_categories';
    protected $fillable = ['name', 'slug', 'status', 'position'];
}
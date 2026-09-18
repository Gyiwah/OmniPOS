<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('stores', function (Blueprint $table) {
            $table->string('platform_status', 24)->default('active')->after('name')->index();
        });

        Schema::table('devices', function (Blueprint $table) {
            $table->string('platform_status', 24)->default('active')->after('platform')->index();
        });
    }

    public function down(): void
    {
        Schema::table('devices', fn (Blueprint $table) => $table->dropColumn('platform_status'));
        Schema::table('stores', fn (Blueprint $table) => $table->dropColumn('platform_status'));
    }
};
<?php

namespace Database\Seeders;

use App\Models\Category;
use App\Models\Customer;
use App\Models\Product;
use App\Models\Store;
use App\Models\StoreMember;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;

/**
 * Development data only. Never run against production.
 *
 * Creates a super admin, one store with a branch, and the three store roles, so
 * that store-scoped authorisation can actually be exercised while developing:
 * signing in as the cashier should fail exactly where the cashier is meant to be
 * blocked.
 */
class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        if (app()->isProduction()) {
            $this->command->error('Refusing to seed a production database.');

            return;
        }

        $superAdmin = User::create([
            'name' => 'Platform Operator',
            'email' => 'super@omnipos.test',
            'password' => Hash::make('password'),
            'is_super_admin' => true,
        ]);

        $admin = User::create([
            'name' => 'Store Admin',
            'email' => 'admin@omnipos.test',
            'password' => Hash::make('password'),
        ]);

        $manager = User::create([
            'name' => 'Store Manager',
            'email' => 'manager@omnipos.test',
            'password' => Hash::make('password'),
        ]);

        $cashier = User::create([
            'name' => 'Till Cashier',
            'email' => 'cashier@omnipos.test',
            'password' => Hash::make('password'),
        ]);

        $store = Store::create([
            'name' => 'OmniPOS Demo Store',
            'owner_user_id' => $admin->id,
            'currency' => 'GHS',
            'timezone' => 'Africa/Accra',
            'tax_rate' => 0,
        ]);

        $branch = Store::create([
            'name' => 'OmniPOS Demo Branch',
            'parent_store_id' => $store->id,
            'owner_user_id' => $admin->id,
            'currency' => 'GHS',
            'timezone' => 'Africa/Accra',
        ]);

        foreach ([
            [$admin, StoreMember::ROLE_ADMIN],
            [$manager, StoreMember::ROLE_MANAGER],
            [$cashier, StoreMember::ROLE_CASHIER],
        ] as [$user, $role]) {
            StoreMember::create([
                'store_id' => $store->id,
                'user_id' => $user->id,
                'role' => $role,
            ]);
        }

        $drinks = Category::create(['store_id' => $store->id, 'name' => 'Drinks', 'position' => 1]);
        $bakery = Category::create(['store_id' => $store->id, 'name' => 'Bakery', 'position' => 2]);

        $catalogue = [
            ['Coca-Cola 500ml', 'SKU-COKE-500', $drinks->id, 10.00, 6.50, 120],
            ['Voltic Water 750ml', 'SKU-WATER-750', $drinks->id, 5.00, 3.00, 200],
            ['White Bread', 'SKU-BREAD-WHT', $bakery->id, 15.00, 9.00, 40],
            ['Meat Pie', 'SKU-PIE-MEAT', $bakery->id, 8.00, 4.50, 25],
        ];

        foreach ($catalogue as [$name, $sku, $categoryId, $price, $cost, $stock]) {
            Product::create([
                'store_id' => $store->id,
                'category_id' => $categoryId,
                'name' => $name,
                'sku' => $sku,
                'price' => $price,
                'cost_price' => $cost,
                'stock' => $stock,
                'reorder_level' => 10,
            ]);
        }

        Customer::create([
            'store_id' => $store->id,
            'name' => 'Ama Mensah',
            'phone' => '0244000000',
        ]);

        $this->command->info('Seeded. All demo accounts use the password: password');
        $this->command->info("  super@omnipos.test    super admin");
        $this->command->info("  admin@omnipos.test    store admin");
        $this->command->info("  manager@omnipos.test  manager");
        $this->command->info("  cashier@omnipos.test  cashier");
        $this->command->info("Store: {$store->id}  Branch: {$branch->id}");
    }
}

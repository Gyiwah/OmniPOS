<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Services\InventoryService;
use App\Services\Migration\SupabaseImporter;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Exercises the real importer against a stand-in Supabase database.
 *
 * A mock source schema is built inside this database, shaped like the Supabase
 * project (including an `auth.users` table), and the `supabase` connection is
 * pointed at it. Everything under test is the production code path.
 *
 * NOT wrapped in DatabaseTransactions: the importer reads over a second PDO
 * connection, which cannot see another connection's uncommitted rows. Fixtures
 * are therefore committed and removed in tearDown.
 */
class SupabaseImportTest extends TestCase
{
    private const STORE = '0192aaaa-0000-7000-8000-000000000001';
    private const OWNER = '0192aaaa-0000-7000-8000-000000000002';
    private const CASHIER = '0192aaaa-0000-7000-8000-000000000003';
    private const INVITED = '0192aaaa-0000-7000-8000-000000000004';
    private const CUSTOMER = '0192aaaa-0000-7000-8000-000000000005';
    private const PRODUCT_A = '0192aaaa-0000-7000-8000-00000000000a';
    private const PRODUCT_B = '0192aaaa-0000-7000-8000-00000000000b';
    private const ORDER_CASH = '0192aaaa-0000-7000-8000-0000000000c1';
    private const ORDER_SPLIT = '0192aaaa-0000-7000-8000-0000000000c2';

    /**
     * A genuine bcrypt hash of "password", rewritten to the $2a$ prefix GoTrue
     * emits. Generated rather than hardcoded so the fixture cannot drift from
     * what it claims to be — and password_verify treats $2a$/$2b$/$2y$ alike,
     * which is precisely the property the import relies on.
     */
    private function legacyHash(): string
    {
        return '$2a$'.substr(password_hash('password', PASSWORD_BCRYPT), 4);
    }

    protected function setUp(): void
    {
        parent::setUp();

        $this->buildMockSource();

        config()->set('database.connections.supabase', array_merge(
            config('database.connections.pgsql'),
            ['search_path' => 'legacy,auth']
        ));
        DB::purge('supabase');
    }

    protected function tearDown(): void
    {
        // Deleting the store cascades to everything scoped to it.
        DB::table('stores')->where('id', self::STORE)->delete();
        DB::table('users')->whereIn('id', [self::OWNER, self::CASHIER, self::INVITED])->delete();
        DB::statement('drop schema if exists legacy cascade');
        DB::statement('drop schema if exists auth cascade');

        parent::tearDown();
    }

    private function buildMockSource(): void
    {
        DB::statement('drop schema if exists legacy cascade');
        DB::statement('drop schema if exists auth cascade');
        DB::statement('create schema legacy');
        DB::statement('create schema auth');

        DB::statement('create table auth.users (
            id uuid primary key, email text, encrypted_password text,
            email_confirmed_at timestamptz, created_at timestamptz, updated_at timestamptz,
            raw_user_meta_data jsonb
        )');
        DB::statement('create table legacy.profiles (
            id uuid primary key, full_name text, avatar_url text, is_super_admin boolean default false
        )');
        DB::statement('create table legacy.stores (
            id uuid primary key, parent_store_id uuid, owner_user_id uuid, name text, email text,
            logo_url text, tax_profile text, currency text, timezone text, language text,
            app_mode_dark boolean, tax_rate numeric, vat_rate numeric, service_rate numeric,
            created_at timestamptz, updated_at timestamptz
        )');
        DB::statement('create table legacy.store_members (
            store_id uuid, user_id uuid, role text, invited_by uuid, created_at timestamptz
        )');
        DB::statement('create table legacy.store_invites (
            id uuid primary key, store_id uuid, email text, role text, status text,
            invited_by uuid, accepted_user_id uuid, expires_at timestamptz,
            created_at timestamptz, updated_at timestamptz
        )');
        DB::statement('create table legacy.customers (
            id uuid primary key, store_id uuid, name text, phone text, email text,
            total_spend numeric, outstanding_balance numeric, notes text,
            created_at timestamptz, updated_at timestamptz
        )');
        DB::statement('create table legacy.products (
            id uuid primary key, store_id uuid, name text, sku text, barcode text,
            price numeric, cost_price numeric, stock integer, reorder_level integer,
            image_url text, tags text[], expiry_date date, is_active boolean,
            created_at timestamptz, updated_at timestamptz
        )');
        DB::statement('create table legacy.product_batches (
            id uuid primary key, store_id uuid, product_id uuid, batch_number text,
            quantity numeric, cost_price numeric, expiry_date date,
            created_at timestamptz, updated_at timestamptz
        )');
        DB::statement('create table legacy.stock_movements (
            id uuid primary key, store_id uuid, product_id uuid, batch_id uuid, type text,
            quantity numeric, quantity_before numeric, quantity_after numeric,
            reason text, notes text, created_at timestamptz
        )');
        DB::statement('create table legacy.price_history (
            id uuid primary key, store_id uuid, product_id uuid, old_sell_price numeric,
            new_sell_price numeric, old_cost_price numeric, new_cost_price numeric,
            reason text, created_at timestamptz
        )');
        DB::statement('create table legacy.orders (
            id uuid primary key, store_id uuid, cashier_user_id uuid, customer_id uuid,
            order_number text, status text, subtotal numeric, tax numeric, discount numeric,
            total numeric, tax_rate numeric, vat_rate numeric, service_rate numeric,
            discount_mode text, discount_value numeric, amount_paid numeric, change_due numeric,
            payment_method text, customer_name text, customer_phone text, shipping_address text,
            created_at timestamptz, updated_at timestamptz
        )');
        DB::statement('create table legacy.order_items (
            id uuid primary key, order_id uuid, store_id uuid, product_id uuid,
            product_name text, sku text, barcode text, unit_price numeric,
            quantity integer, line_total numeric, created_at timestamptz
        )');
        DB::statement('create table legacy.returns (
            id uuid primary key, store_id uuid, order_id uuid, processed_by_user_id uuid,
            reason text, amount numeric, created_at timestamptz, updated_at timestamptz
        )');
        DB::statement('create table legacy.return_items (
            id uuid primary key, return_id uuid, store_id uuid, order_item_id uuid,
            product_id uuid, product_name text, unit_price numeric, quantity integer,
            line_total numeric, created_at timestamptz
        )');

        $now = now()->toDateTimeString();
        $hash = $this->legacyHash();

        DB::table('auth.users')->insert([
            ['id' => self::OWNER, 'email' => 'Owner@Legacy.test', 'encrypted_password' => $hash,
                'email_confirmed_at' => $now, 'created_at' => $now, 'updated_at' => $now, 'raw_user_meta_data' => '{}'],
            ['id' => self::CASHIER, 'email' => 'cashier@legacy.test', 'encrypted_password' => $hash,
                'email_confirmed_at' => $now, 'created_at' => $now, 'updated_at' => $now, 'raw_user_meta_data' => '{}'],
            // Invite-only account: never had a password.
            ['id' => self::INVITED, 'email' => 'invited@legacy.test', 'encrypted_password' => null,
                'email_confirmed_at' => null, 'created_at' => $now, 'updated_at' => $now,
                'raw_user_meta_data' => '{"full_name":"Invited Person"}'],
        ]);

        DB::table('legacy.profiles')->insert([
            ['id' => self::OWNER, 'full_name' => 'Legacy Owner', 'avatar_url' => null, 'is_super_admin' => true],
            ['id' => self::CASHIER, 'full_name' => 'Legacy Cashier', 'avatar_url' => null, 'is_super_admin' => false],
        ]);

        DB::table('legacy.stores')->insert([[
            'id' => self::STORE, 'parent_store_id' => null, 'owner_user_id' => self::OWNER,
            'name' => 'Legacy Store', 'email' => null, 'logo_url' => null, 'tax_profile' => 'standard',
            'currency' => 'GHS', 'timezone' => 'Africa/Accra', 'language' => 'English',
            'app_mode_dark' => false, 'tax_rate' => 0, 'vat_rate' => 0, 'service_rate' => 0,
            'created_at' => $now, 'updated_at' => $now,
        ]]);

        DB::table('legacy.store_members')->insert([
            ['store_id' => self::STORE, 'user_id' => self::OWNER, 'role' => 'admin', 'invited_by' => null, 'created_at' => $now],
            ['store_id' => self::STORE, 'user_id' => self::CASHIER, 'role' => 'cashier', 'invited_by' => null, 'created_at' => $now],
        ]);

        DB::table('legacy.customers')->insert([[
            'id' => self::CUSTOMER, 'store_id' => self::STORE, 'name' => 'Legacy Customer',
            'phone' => '0244', 'email' => null,
            // Deliberately wrong: the importer must recompute from the orders.
            'total_spend' => 99999, 'outstanding_balance' => 12345, 'notes' => null,
            'created_at' => $now, 'updated_at' => $now,
        ]]);

        DB::statement("insert into legacy.products values
            (?, ?, 'Widget A', 'SKU-A', null, 10, 6, 40, 5, null, '{\"tag1\",\"tag2\"}', null, true, ?, ?),
            (?, ?, 'Widget B', 'SKU-B', null, 25, 15, 7, 5, null, '{}', null, true, ?, ?)",
            [self::PRODUCT_A, self::STORE, $now, $now, self::PRODUCT_B, self::STORE, $now, $now]);

        // Two historical movements for A: a sale of 3 and a stock-in of 10.
        // A's stock in Supabase is 40, so the ledger must be topped up by 33.
        DB::table('legacy.stock_movements')->insert([
            ['id' => '0192aaaa-0000-7000-8000-00000000e1a1', 'store_id' => self::STORE,
                'product_id' => self::PRODUCT_A, 'batch_id' => null, 'type' => 'SALE',
                'quantity' => -3, 'quantity_before' => 33, 'quantity_after' => 30,
                'reason' => 'Sale', 'notes' => null, 'created_at' => $now],
            ['id' => '0192aaaa-0000-7000-8000-00000000e2a2', 'store_id' => self::STORE,
                'product_id' => self::PRODUCT_A, 'batch_id' => null, 'type' => 'STOCK_IN',
                'quantity' => 10, 'quantity_before' => 30, 'quantity_after' => 40,
                'reason' => 'Delivery', 'notes' => null, 'created_at' => $now],
        ]);

        DB::table('legacy.orders')->insert([
            ['id' => self::ORDER_CASH, 'store_id' => self::STORE, 'cashier_user_id' => self::CASHIER,
                'customer_id' => self::CUSTOMER, 'order_number' => 'L-001', 'status' => 'completed',
                'subtotal' => 30, 'tax' => 0, 'discount' => 0, 'total' => 30, 'tax_rate' => 0,
                'vat_rate' => 0, 'service_rate' => 0, 'discount_mode' => 'percentage', 'discount_value' => 0,
                'amount_paid' => 30, 'change_due' => 0, 'payment_method' => 'cash',
                'customer_name' => null, 'customer_phone' => null, 'shipping_address' => null,
                'created_at' => $now, 'updated_at' => $now],
            // A split-tender sale, partially paid: the breakdown was never recorded.
            ['id' => self::ORDER_SPLIT, 'store_id' => self::STORE, 'cashier_user_id' => self::CASHIER,
                'customer_id' => self::CUSTOMER, 'order_number' => 'L-002', 'status' => 'completed',
                'subtotal' => 100, 'tax' => 0, 'discount' => 0, 'total' => 100, 'tax_rate' => 0,
                'vat_rate' => 0, 'service_rate' => 0, 'discount_mode' => 'percentage', 'discount_value' => 0,
                'amount_paid' => 60, 'change_due' => 0, 'payment_method' => 'split',
                'customer_name' => null, 'customer_phone' => null, 'shipping_address' => null,
                'created_at' => $now, 'updated_at' => $now],
        ]);

        DB::table('legacy.order_items')->insert([[
            'id' => '0192aaaa-0000-7000-8000-00000000f1b1', 'order_id' => self::ORDER_CASH,
            'store_id' => self::STORE, 'product_id' => self::PRODUCT_A, 'product_name' => 'Widget A',
            'sku' => 'SKU-A', 'barcode' => null, 'unit_price' => 10, 'quantity' => 3,
            'line_total' => 30, 'created_at' => $now,
        ]]);
    }

    private function import(): SupabaseImporter
    {
        return app(SupabaseImporter::class);
    }

    private function runAll(): void
    {
        foreach ($this->import()->steps() as $step) {
            $step();
        }
    }

    public function test_it_imports_every_entity_preserving_identity(): void
    {
        $this->runAll();

        $this->assertDatabaseHas('stores', ['id' => self::STORE, 'name' => 'Legacy Store', 'currency' => 'GHS']);
        $this->assertDatabaseHas('products', ['id' => self::PRODUCT_A, 'sku' => 'SKU-A']);
        $this->assertDatabaseHas('orders', ['id' => self::ORDER_CASH, 'order_number' => 'L-001']);
        $this->assertDatabaseHas('order_items', ['id' => '0192aaaa-0000-7000-8000-00000000f1b1']);
        $this->assertDatabaseHas('customers', ['id' => self::CUSTOMER, 'name' => 'Legacy Customer']);

        // store_members had a composite key at source and gains its own id here.
        $this->assertSame(2, DB::table('store_members')->where('store_id', self::STORE)->count());
    }

    public function test_bcrypt_passwords_carry_over_and_unusable_ones_are_discarded(): void
    {
        $this->runAll();

        $owner = DB::table('users')->where('id', self::OWNER)->first();
        $this->assertStringStartsWith('$2a$', $owner->password, 'the GoTrue hash must transfer unchanged');
        $this->assertTrue(password_verify('password', $owner->password), 'the carried hash must still verify');
        $this->assertSame('owner@legacy.test', $owner->email, 'emails are normalised to lower case');
        $this->assertTrue((bool) $owner->is_super_admin, 'is_super_admin comes from profiles');

        $invited = DB::table('users')->where('id', self::INVITED)->first();
        $this->assertNull($invited->password, 'an account with no password must not be given one');
        $this->assertSame('Invited Person', $invited->name, 'name falls back to user metadata');
    }

    public function test_the_ledger_is_reconciled_to_the_quantity_supabase_reported(): void
    {
        $this->runAll();

        $inventory = app(InventoryService::class);

        // A had movements summing to +7 (-3 sale, +10 delivery) and Supabase said
        // 40, so an adjusting movement of +33 must have been posted.
        $a = Product::find(self::PRODUCT_A);
        $this->assertSame(40, (int) $a->stock);
        $this->assertSame(40.0, $inventory->ledgerBalance(self::PRODUCT_A));

        $audit = DB::table('stock_movements')
            ->where('product_id', self::PRODUCT_A)->where('type', 'AUDIT')->first();
        $this->assertNotNull($audit, 'a reconciling movement should exist');
        $this->assertSame('33.00', $audit->quantity);
        $this->assertStringContainsString('reconciliation', $audit->reason);

        // The original movements survived rather than being replaced.
        $this->assertSame(3, DB::table('stock_movements')->where('product_id', self::PRODUCT_A)->count());

        // B had no movements at all; its whole quantity arrives as one adjustment.
        $b = Product::find(self::PRODUCT_B);
        $this->assertSame(7, (int) $b->stock);
        $this->assertSame(7.0, $inventory->ledgerBalance(self::PRODUCT_B));
    }

    public function test_payments_are_synthesised_and_split_tender_is_not_filed_as_cash(): void
    {
        $this->runAll();

        $cash = DB::table('payments')->where('order_id', self::ORDER_CASH)->first();
        $this->assertSame('cash', $cash->method);
        $this->assertSame('30.00', $cash->amount);

        $split = DB::table('payments')->where('order_id', self::ORDER_SPLIT)->first();
        $this->assertSame('other', $split->method, "'split' must not be recorded as cash — it would inflate the drawer");
        $this->assertSame('60.00', $split->amount, 'only the amount actually paid');
        $this->assertStringContainsString('not recorded', $split->notes);
    }

    public function test_customer_totals_are_recomputed_from_evidence_not_copied(): void
    {
        $this->runAll();

        $customer = DB::table('customers')->where('id', self::CUSTOMER)->first();

        // Source claimed 99999 / 12345. Truth: 130 sold, 90 paid, 40 outstanding.
        $this->assertSame('130.00', $customer->total_spend);
        $this->assertSame('40.00', $customer->outstanding_balance);
    }

    public function test_running_the_import_twice_changes_nothing(): void
    {
        $this->runAll();

        $before = [
            'users' => DB::table('users')->count(),
            'orders' => DB::table('orders')->count(),
            'payments' => DB::table('payments')->count(),
            'movements' => DB::table('stock_movements')->count(),
            'members' => DB::table('store_members')->count(),
            'stock_a' => Product::find(self::PRODUCT_A)->stock,
        ];

        // Cutover runs the import again to sweep up the last hours of trading.
        $this->runAll();

        $after = [
            'users' => DB::table('users')->count(),
            'orders' => DB::table('orders')->count(),
            'payments' => DB::table('payments')->count(),
            'movements' => DB::table('stock_movements')->count(),
            'members' => DB::table('store_members')->count(),
            'stock_a' => Product::find(self::PRODUCT_A)->stock,
        ];

        $this->assertSame($before, $after, 'a second run must be a no-op — no duplicate sales, no double stock');
    }
}

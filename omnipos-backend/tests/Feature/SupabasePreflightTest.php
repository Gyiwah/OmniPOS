<?php

namespace Tests\Feature;

use App\Services\Migration\SupabasePreflight;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * The pre-flight audit, against a source seeded with each problem it looks for.
 *
 * Every check here corresponds to a constraint in the target schema, and the
 * point of the test is that a real Supabase project containing that shape is
 * reported rather than discovered two thirds of the way through a migration at
 * midnight.
 *
 * NOT wrapped in DatabaseTransactions: the audit reads over a second PDO
 * connection, which cannot see another connection's uncommitted rows. Fixtures
 * are committed and dropped in tearDown, exactly as SupabaseImportTest does.
 */
class SupabasePreflightTest extends TestCase
{
    private const STORE = '0192bbbb-0000-7000-8000-000000000001';
    private const OWNER = '0192bbbb-0000-7000-8000-000000000002';
    private const PRODUCT = '0192bbbb-0000-7000-8000-00000000000a';

    protected function setUp(): void
    {
        parent::setUp();

        $this->buildSource();

        config()->set('database.connections.supabase', array_merge(
            config('database.connections.pgsql'),
            ['search_path' => 'legacy,auth']
        ));
        DB::purge('supabase');
    }

    protected function tearDown(): void
    {
        DB::statement('drop schema if exists legacy cascade');
        DB::statement('drop schema if exists auth cascade');

        parent::tearDown();
    }

    /** A minimal, healthy source. Individual tests break one thing at a time. */
    private function buildSource(): void
    {
        DB::statement('drop schema if exists legacy cascade');
        DB::statement('drop schema if exists auth cascade');
        DB::statement('create schema legacy');
        DB::statement('create schema auth');

        DB::statement('create table auth.users (id uuid primary key, email text, encrypted_password text)');
        DB::statement('create table legacy.stores (
            id uuid primary key, parent_store_id uuid, owner_user_id uuid, name text,
            tax_rate numeric default 0, vat_rate numeric default 0, service_rate numeric default 0
        )');
        DB::statement('create table legacy.store_members (store_id uuid, user_id uuid, role text)');
        DB::statement('create table legacy.products (
            id uuid primary key, store_id uuid, name text, sku text, price numeric
        )');
        DB::statement('create table legacy.product_batches (
            id uuid primary key, store_id uuid, product_id uuid, batch_number text
        )');
        DB::statement('create table legacy.stock_movements (id uuid primary key, product_id uuid, type text)');
        DB::statement('create table legacy.orders (
            id uuid primary key, store_id uuid, order_number text, status text,
            total numeric default 0, amount_paid numeric default 0, tax numeric default 0,
            discount numeric default 0, payment_method text
        )');
        DB::statement('create table legacy.order_items (
            id uuid primary key, order_id uuid, quantity integer, line_total numeric default 0
        )');
        DB::statement('create table legacy.returns (id uuid primary key, order_id uuid)');
        DB::statement('create table legacy.return_items (id uuid primary key, order_item_id uuid, quantity integer)');

        $hash = '$2a$'.substr(password_hash('password', PASSWORD_BCRYPT), 4);

        DB::table('auth.users')->insert([
            ['id' => self::OWNER, 'email' => 'owner@legacy.test', 'encrypted_password' => $hash],
        ]);
        DB::table('legacy.stores')->insert([
            ['id' => self::STORE, 'owner_user_id' => self::OWNER, 'name' => 'Legacy Store'],
        ]);
        DB::table('legacy.store_members')->insert([
            ['store_id' => self::STORE, 'user_id' => self::OWNER, 'role' => 'admin'],
        ]);
        DB::table('legacy.products')->insert([
            ['id' => self::PRODUCT, 'store_id' => self::STORE, 'name' => 'Widget', 'sku' => 'W-1', 'price' => 10],
        ]);
    }

    /** @return array<int, array<string, mixed>> */
    private function audit(): array
    {
        return app(SupabasePreflight::class)->run();
    }

    private function findings(array $all, string $area, string $grade): array
    {
        return array_values(array_filter($all, fn ($f) => $f['area'] === $area && $f['grade'] === $grade));
    }

    /**
     * A source with no return_items table at all.
     *
     * Not hypothetical: the production project models a refund as one row with
     * an amount and no line detail, so the table does not exist. The audit used
     * to join to it unguarded and died before printing a single finding — the
     * tool built to find problems before cutover could not run against the real
     * source.
     */
    public function test_a_source_without_return_items_is_reported_not_fatal(): void
    {
        DB::statement('drop table if exists legacy.return_items');

        // Against a real sale, so the only thing under test is the absent table.
        DB::table('legacy.orders')->insert([
            ['id' => '0192bbbb-0000-7000-8000-0000000000e0', 'store_id' => self::STORE,
                'order_number' => 'OM-RET-1', 'status' => 'completed'],
        ]);
        DB::table('legacy.returns')->insert([
            ['id' => '0192bbbb-0000-7000-8000-0000000000e1', 'order_id' => '0192bbbb-0000-7000-8000-0000000000e0'],
        ]);

        $findings = $this->audit();

        $this->assertSame(
            0,
            app(SupabasePreflight::class)->blocking($findings),
            'a missing optional table must not block: '.json_encode(array_column($findings, 'detail')),
        );

        $found = $this->findings($findings, 'return_items', SupabasePreflight::ALTERED);
        $this->assertNotEmpty($found, 'the loss should be reported');
        $this->assertStringContainsString('no return_items table', implode(' ', array_column($found, 'detail')));
    }

    public function test_a_clean_source_reports_nothing_blocking(): void
    {
        $findings = $this->audit();

        $this->assertSame(
            0,
            app(SupabasePreflight::class)->blocking($findings),
            'clean fixture produced: '.json_encode(array_column($findings, 'detail')),
        );
    }

    /**
     * GoTrue allows the same address under two providers, and the target makes
     * email unique — so one of each pair would silently fail to import.
     */
    public function test_it_catches_two_accounts_sharing_an_email(): void
    {
        DB::table('auth.users')->insert([
            ['id' => '0192bbbb-0000-7000-8000-0000000000f1', 'email' => 'Owner@Legacy.TEST', 'encrypted_password' => 'x'],
        ]);

        $found = $this->findings($this->audit(), 'users', SupabasePreflight::BLOCKING);

        $this->assertNotEmpty($found);
        $this->assertStringContainsString('share an email', implode(' ', array_column($found, 'detail')));
    }

    /** These import and then cannot sign in, which is found on cutover morning. */
    public function test_it_catches_a_password_hash_that_is_not_bcrypt(): void
    {
        DB::table('auth.users')->insert([
            ['id' => '0192bbbb-0000-7000-8000-0000000000f2', 'email' => 'argon@legacy.test',
                'encrypted_password' => '$argon2id$v=19$m=65536,t=4,p=1$abc$def'],
        ]);

        $found = $this->findings($this->audit(), 'users', SupabasePreflight::BLOCKING);

        $this->assertStringContainsString('not bcrypt', implode(' ', array_column($found, 'detail')));
    }

    /**
     * An account with no password is not an account whose hash we cannot read.
     *
     * GoTrue writes '' rather than NULL for a magic-link or provider sign-in,
     * and the check for a foreign algorithm was `is not null`, so every one of
     * them was reported as blocking. Blocking findings must be cleared before
     * the import may run, so a real cutover would have stalled while somebody
     * looked for a hash format that did not exist. Production had exactly one.
     */
    public function test_an_empty_password_is_a_note_not_a_blocking_hash_problem(): void
    {
        DB::table('auth.users')->insert([
            ['id' => '0192bbbb-0000-7000-8000-0000000000d1', 'email' => 'magiclink@legacy.test',
                'encrypted_password' => ''],
        ]);

        $findings = $this->audit();

        $this->assertSame(
            0,
            app(SupabasePreflight::class)->blocking($findings),
            'an account with no password must not block: '.json_encode(array_column($findings, 'detail')),
        );

        $noted = $this->findings($findings, 'users', SupabasePreflight::NOTE);
        $this->assertStringContainsString('no password at all', implode(' ', array_column($noted, 'detail')));
    }

    public function test_it_catches_a_store_whose_owner_is_missing(): void
    {
        DB::table('legacy.stores')->insert([
            ['id' => '0192bbbb-0000-7000-8000-0000000000f3', 'owner_user_id' => '0192bbbb-0000-7000-8000-0000000000ff', 'name' => 'Orphan'],
        ]);

        $found = $this->findings($this->audit(), 'stores', SupabasePreflight::BLOCKING);

        $this->assertStringContainsString('owner is missing', implode(' ', array_column($found, 'detail')));
    }

    public function test_it_catches_a_tax_rate_outside_the_allowed_range(): void
    {
        DB::table('legacy.stores')->where('id', self::STORE)->update(['vat_rate' => 175]);

        $found = $this->findings($this->audit(), 'stores', SupabasePreflight::BLOCKING);

        $this->assertStringContainsString('vat_rate', implode(' ', array_column($found, 'detail')));
    }

    public function test_it_catches_a_duplicate_sku_within_one_store(): void
    {
        DB::table('legacy.products')->insert([
            ['id' => '0192bbbb-0000-7000-8000-0000000000f4', 'store_id' => self::STORE,
                'name' => 'Widget copy', 'sku' => 'W-1', 'price' => 12],
        ]);

        $found = $this->findings($this->audit(), 'products', SupabasePreflight::BLOCKING);

        $this->assertStringContainsString('same SKU used twice', implode(' ', array_column($found, 'detail')));
    }

    /**
     * The one that matters most. Each duplicate is a sale a customer holds a
     * receipt for, and the target refuses the second.
     */
    public function test_it_catches_a_receipt_number_used_twice_in_one_store(): void
    {
        foreach (['0192bbbb-0000-7000-8000-0000000000e1', '0192bbbb-0000-7000-8000-0000000000e2'] as $id) {
            DB::table('legacy.orders')->insert([
                ['id' => $id, 'store_id' => self::STORE, 'order_number' => 'OM-1', 'status' => 'completed'],
            ]);
        }

        $found = $this->findings($this->audit(), 'orders', SupabasePreflight::BLOCKING);

        $this->assertStringContainsString('same receipt number', implode(' ', array_column($found, 'detail')));
    }

    /** A status with a defined meaning here arrives changed, and is reported as such. */
    public function test_it_reports_a_status_that_will_be_mapped_to_a_different_value(): void
    {
        DB::table('legacy.orders')->insert([
            ['id' => '0192bbbb-0000-7000-8000-0000000000e3', 'store_id' => self::STORE,
                'order_number' => 'OM-2', 'status' => 'part_paid'],
        ]);

        $found = $this->findings($this->audit(), 'orders', SupabasePreflight::ALTERED);

        $this->assertStringContainsString('become a different value', implode(' ', array_column($found, 'detail')));
        $this->assertSame('completed', $found[0]['examples'][0]['becomes']);
    }

    /**
     * A status nothing knows how to map is BLOCKING, not a warning.
     *
     * It was graded as merely altered, on the strength of a mapping that did not
     * exist — and the run it blessed died on a check constraint two thirds of the
     * way through the orders step. The grade now comes from the mapping itself.
     */
    public function test_an_unmappable_status_blocks_rather_than_warns(): void
    {
        DB::table('legacy.orders')->insert([
            ['id' => '0192bbbb-0000-7000-8000-0000000000e9', 'store_id' => self::STORE,
                'order_number' => 'OM-9', 'status' => 'layaway'],
        ]);

        $found = $this->findings($this->audit(), 'orders', SupabasePreflight::BLOCKING);

        $this->assertStringContainsString('no equivalent here', implode(' ', array_column($found, 'detail')));
    }

    public function test_it_catches_a_batch_with_no_batch_number(): void
    {
        DB::table('legacy.product_batches')->insert([
            ['id' => '0192bbbb-0000-7000-8000-0000000000d1', 'store_id' => self::STORE,
                'product_id' => self::PRODUCT, 'batch_number' => null],
        ]);

        $found = $this->findings($this->audit(), 'product_batches', SupabasePreflight::BLOCKING);

        $this->assertStringContainsString('no batch number', implode(' ', array_column($found, 'detail')));
    }

    public function test_it_reports_a_movement_type_the_ledger_does_not_accept(): void
    {
        DB::table('legacy.stock_movements')->insert([
            ['id' => '0192bbbb-0000-7000-8000-0000000000c1', 'product_id' => self::PRODUCT, 'type' => 'PURCHASE'],
        ]);

        $found = $this->findings($this->audit(), 'stock_movements', SupabasePreflight::ALTERED);

        $this->assertStringContainsString('Movement types the target does not have', implode(' ', array_column($found, 'detail')));
    }

    /**
     * Supabase kept no payment rows, so a split sale's cash portion cannot be
     * recovered — and a drawer reconciliation will never balance for those days.
     */
    public function test_it_warns_about_split_payments_whose_breakdown_is_lost(): void
    {
        DB::table('legacy.orders')->insert([
            ['id' => '0192bbbb-0000-7000-8000-0000000000e4', 'store_id' => self::STORE,
                'order_number' => 'OM-3', 'status' => 'completed', 'payment_method' => 'split'],
        ]);

        $found = $this->findings($this->audit(), 'payments', SupabasePreflight::NOTE);

        $this->assertStringContainsString('split tender', implode(' ', array_column($found, 'detail')));
    }

    public function test_it_notes_a_store_with_nobody_able_to_administer_it(): void
    {
        DB::table('legacy.stores')->insert([
            ['id' => '0192bbbb-0000-7000-8000-0000000000b1', 'owner_user_id' => self::OWNER, 'name' => 'No admin'],
        ]);

        $found = $this->findings($this->audit(), 'store_members', SupabasePreflight::NOTE);

        $this->assertStringContainsString('no admin', implode(' ', array_column($found, 'detail')));
    }

    public function test_it_notes_a_line_returned_more_times_than_it_was_sold(): void
    {
        DB::table('legacy.orders')->insert([
            ['id' => '0192bbbb-0000-7000-8000-0000000000e5', 'store_id' => self::STORE,
                'order_number' => 'OM-4', 'status' => 'completed'],
        ]);
        DB::table('legacy.order_items')->insert([
            ['id' => '0192bbbb-0000-7000-8000-0000000000a1', 'order_id' => '0192bbbb-0000-7000-8000-0000000000e5', 'quantity' => 2],
        ]);
        DB::table('legacy.return_items')->insert([
            ['id' => '0192bbbb-0000-7000-8000-0000000000a2', 'order_item_id' => '0192bbbb-0000-7000-8000-0000000000a1', 'quantity' => 3],
        ]);

        $found = $this->findings($this->audit(), 'return_items', SupabasePreflight::NOTE);

        $this->assertStringContainsString('more returned than was ever sold', implode(' ', array_column($found, 'detail')));
    }

    /** The command has to fail, or a cutover script would carry on regardless. */
    public function test_the_command_exits_non_zero_when_something_is_blocking(): void
    {
        DB::table('legacy.products')->insert([
            ['id' => '0192bbbb-0000-7000-8000-0000000000f9', 'store_id' => self::STORE,
                'name' => 'Clash', 'sku' => 'W-1', 'price' => 1],
        ]);

        $this->artisan('omnipos:preflight-supabase')
            ->expectsOutputToContain('BLOCKING')
            ->assertExitCode(1);
    }

    public function test_the_command_emits_json_when_asked(): void
    {
        $this->artisan('omnipos:preflight-supabase --json')->assertExitCode(0);
    }
}

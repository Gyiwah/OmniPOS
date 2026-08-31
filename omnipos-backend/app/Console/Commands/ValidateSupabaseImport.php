<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * php artisan omnipos:validate-import
 *
 * Implements sections 38 and 39 of the migration plan: prove the migration
 * actually landed rather than assuming it did because the tables exist.
 *
 * Two classes of check, and the second matters more:
 *
 *   RECORD COUNTS  — did every row arrive.
 *   FINANCIAL      — do the money totals agree to the cent. A migration that
 *                    moves 100% of rows but changes the day's takings is a
 *                    failed migration.
 *
 * Exits non-zero if anything disagrees, so it can gate a cutover script.
 */
class ValidateSupabaseImport extends Command
{
    protected $signature = 'omnipos:validate-import {--store= : Restrict financial checks to one store}';

    protected $description = 'Compare row counts and financial totals between Supabase and this database.';

    private bool $failed = false;

    public function handle(): int
    {
        try {
            DB::connection('supabase')->getPdo();
        } catch (Throwable $e) {
            $this->error('Could not connect to the Supabase source: '.$e->getMessage());

            return self::FAILURE;
        }

        $this->newLine();
        $this->info('RECORD COUNTS');
        $this->counts();

        $this->newLine();
        $this->info('FINANCIAL TOTALS');
        $this->financials();

        $this->newLine();
        $this->info('INTEGRITY');
        $this->integrity();

        $this->newLine();
        if ($this->failed) {
            $this->error('Validation FAILED. Do not cut over until these are explained.');

            return self::FAILURE;
        }

        $this->info('All checks passed.');

        return self::SUCCESS;
    }

    private function counts(): void
    {
        $tables = [
            'stores', 'store_members', 'store_invites', 'customers', 'products',
            'product_batches', 'stock_movements', 'price_history',
            'orders', 'order_items', 'returns', 'return_items',
        ];

        $rows = [];

        foreach ($tables as $table) {
            try {
                $source = DB::connection('supabase')->table($table)->count();
            } catch (Throwable) {
                // Table may not exist in older Supabase projects.
                $rows[] = [$table, 'n/a', DB::table($table)->count(), '-'];

                continue;
            }

            $target = DB::table($table)->count();
            $ok = $source === $target;
            if (! $ok) {
                $this->failed = true;
            }

            $rows[] = [$table, $source, $target, $ok ? 'OK' : 'MISMATCH ('.($target - $source).')'];
        }

        // users is a join of auth.users and profiles, so it is counted separately.
        try {
            $sourceUsers = DB::connection('supabase')->table('auth.users')->whereNotNull('email')->count();
            $targetUsers = DB::table('users')->count();
            if ($sourceUsers !== $targetUsers) {
                $this->failed = true;
            }
            $rows[] = ['users', $sourceUsers, $targetUsers, $sourceUsers === $targetUsers ? 'OK' : 'MISMATCH'];
        } catch (Throwable $e) {
            $rows[] = ['users', 'unreadable', DB::table('users')->count(), 'CHECK MANUALLY'];
        }

        $this->table(['table', 'supabase', 'omnipos', 'result'], $rows);
    }

    private function financials(): void
    {
        $storeFilter = $this->option('store');

        $scope = fn ($q) => $storeFilter ? $q->where('store_id', $storeFilter) : $q;

        $checks = [
            'gross sales (completed)' => [
                fn () => $scope(DB::connection('supabase')->table('orders')->where('status', 'completed'))->sum('total'),
                fn () => $scope(DB::table('orders')->where('status', 'completed'))->sum('total'),
            ],
            'amount paid' => [
                fn () => $scope(DB::connection('supabase')->table('orders'))->sum('amount_paid'),
                fn () => $scope(DB::table('orders'))->sum('amount_paid'),
            ],
            'tax collected' => [
                fn () => $scope(DB::connection('supabase')->table('orders'))->sum('tax'),
                fn () => $scope(DB::table('orders'))->sum('tax'),
            ],
            'discount given' => [
                fn () => $scope(DB::connection('supabase')->table('orders'))->sum('discount'),
                fn () => $scope(DB::table('orders'))->sum('discount'),
            ],
            'returns refunded' => [
                fn () => $scope(DB::connection('supabase')->table('returns'))->sum('amount'),
                fn () => $scope(DB::table('returns'))->sum('amount'),
            ],
            'order line value' => [
                fn () => $scope(DB::connection('supabase')->table('order_items'))->sum('line_total'),
                fn () => $scope(DB::table('order_items'))->sum('line_total'),
            ],
            'total stock on hand' => [
                fn () => $scope(DB::connection('supabase')->table('products'))->sum('stock'),
                fn () => $scope(DB::table('products'))->sum('stock'),
            ],
        ];

        $rows = [];
        foreach ($checks as $label => [$sourceFn, $targetFn]) {
            try {
                $source = number_format((float) $sourceFn(), 2, '.', '');
                $target = number_format((float) $targetFn(), 2, '.', '');
                $ok = bccomp($source, $target, 2) === 0;
                if (! $ok) {
                    $this->failed = true;
                }
                $rows[] = [$label, $source, $target, $ok ? 'OK' : 'DIFFERS by '.bcsub($target, $source, 2)];
            } catch (Throwable $e) {
                $rows[] = [$label, 'error', 'error', $e->getMessage()];
                $this->failed = true;
            }
        }

        $this->table(['measure', 'supabase', 'omnipos', 'result'], $rows);

        // The payments ledger is new; it should reproduce what orders recorded.
        $paid = (float) $scope(DB::table('orders')->whereNot('status', 'voided'))->sum('amount_paid');
        $payments = (float) $scope(DB::table('payments'))->sum('amount');
        $ok = bccomp(number_format($paid, 2, '.', ''), number_format($payments, 2, '.', ''), 2) === 0;
        if (! $ok) {
            $this->failed = true;
        }
        $this->line(sprintf(
            '  synthesised payments %s orders.amount_paid: %s vs %s  %s',
            $ok ? 'match' : 'DO NOT MATCH',
            number_format($paid, 2),
            number_format($payments, 2),
            $ok ? 'OK' : 'MISMATCH'
        ));
    }

    /**
     * The ledger is the whole point of the new inventory model, so prove it
     * agrees with the cached column everywhere before trusting it.
     */
    private function integrity(): void
    {
        $drift = DB::select("
            select p.id, p.name, p.stock, coalesce(sum(m.quantity), 0) as ledger
            from products p
            left join stock_movements m on m.product_id = p.id
            group by p.id, p.name, p.stock
            having p.stock <> coalesce(sum(m.quantity), 0)
            limit 20
        ");

        if ($drift) {
            $this->failed = true;
            $this->error('  products whose cached stock disagrees with the ledger:');
            foreach ($drift as $d) {
                $this->line(sprintf('    %-30s cached=%s ledger=%s', $d->name, $d->stock, $d->ledger));
            }
            $this->warn('  Run: php artisan omnipos:import-supabase --only=stock_reconcile');
        } else {
            $this->line('  every product\'s cached stock equals its ledger  OK');
        }

        $orphanItems = DB::table('order_items')
            ->leftJoin('orders', 'orders.id', '=', 'order_items.order_id')
            ->whereNull('orders.id')->count();
        $this->line('  order_items with no order: '.$orphanItems.($orphanItems ? '  ORPHANED' : '  OK'));
        if ($orphanItems) {
            $this->failed = true;
        }

        $noPassword = DB::table('users')->whereNull('password')->count();
        $this->line('  users needing a password reset: '.$noPassword.'  (expected for invite/magic-link accounts)');

        $negative = DB::table('products')->where('stock', '<', 0)->count();
        $this->line('  products with negative stock: '.$negative.($negative ? '  review these' : '  OK'));
    }
}

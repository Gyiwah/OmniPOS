<?php

namespace App\Console\Commands;

use App\Services\Migration\SupabaseImporter;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * php artisan omnipos:import-supabase
 *
 * One-time data migration from the Supabase project. Safe to run repeatedly:
 * every step skips rows already present, so a failed or interrupted run can be
 * resumed, and the command can be run again at cutover to pick up the last few
 * hours of trading.
 */
class ImportFromSupabase extends Command
{
    protected $signature = 'omnipos:import-supabase
        {--only=* : Run only these steps (see --list)}
        {--skip=* : Skip these steps}
        {--chunk=500 : Rows per batch}
        {--list : Show the steps in order and exit}';

    protected $description = 'Import data from the legacy Supabase database into this PostgreSQL database.';

    public function handle(SupabaseImporter $importer): int
    {
        $steps = $importer->steps();

        if ($this->option('list')) {
            $this->info('Steps run in this order (foreign-key dependency order):');
            foreach (array_keys($steps) as $i => $name) {
                $this->line(sprintf('  %2d. %s', $i + 1, $name));
            }

            return self::SUCCESS;
        }

        if (! $this->checkSource()) {
            return self::FAILURE;
        }

        $only = $this->option('only');
        $skip = $this->option('skip');

        $importer->chunkSize((int) $this->option('chunk'))
            ->onProgress(fn (string $m) => $this->line('  '.$m));

        $this->newLine();
        $this->info('Importing from Supabase. This is additive and idempotent; nothing is deleted.');
        $this->newLine();

        $started = microtime(true);
        $summary = [];

        foreach ($steps as $name => $run) {
            if ($only && ! in_array($name, $only, true)) {
                continue;
            }
            if (in_array($name, $skip, true)) {
                $this->line("  {$name}: skipped");

                continue;
            }

            $this->line("<fg=cyan>{$name}</>");

            try {
                $result = $run();
                $summary[$name] = $result;
            } catch (Throwable $e) {
                $this->newLine();
                $this->error("Step [{$name}] failed: ".$e->getMessage());
                $this->warn('Nothing after this step ran. Fix the cause and run the command again —');
                $this->warn('already-imported rows are skipped, so it resumes rather than duplicating.');

                return self::FAILURE;
            }
        }

        $this->newLine();
        $this->info(sprintf('Done in %.1fs.', microtime(true) - $started));

        if (isset($summary['users']['needs_password_reset']) && $summary['users']['needs_password_reset'] > 0) {
            $this->newLine();
            $this->warn($summary['users']['needs_password_reset'].' user(s) have no usable password and must set one before signing in.');
            $this->warn('These are invite-only and magic-link accounts, which never had a password in Supabase.');
        }

        $this->newLine();
        $this->info('Next: php artisan omnipos:validate-import');

        return self::SUCCESS;
    }

    /** Fail early and clearly rather than part-way through a table. */
    private function checkSource(): bool
    {
        if (! config('database.connections.supabase.host') && ! config('database.connections.supabase.url')) {
            $this->error('The supabase connection is not configured.');
            $this->line('Set SUPABASE_DB_HOST / SUPABASE_DB_USERNAME / SUPABASE_DB_PASSWORD in .env.');
            $this->line('Find them in the Supabase dashboard under Project -> Connect.');

            return false;
        }

        try {
            $count = DB::connection('supabase')->table('stores')->count();
            $this->line("Connected to Supabase. {$count} store(s) at source.");

            return true;
        } catch (Throwable $e) {
            $this->error('Could not read from Supabase: '.$e->getMessage());

            return false;
        }
    }
}

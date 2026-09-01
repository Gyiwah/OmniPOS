<?php

namespace App\Console\Commands;

use App\Services\Migration\SupabasePreflight;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * php artisan omnipos:preflight-supabase
 *
 * What will go wrong, before anything is written.
 *
 * Reads the Supabase source and this database and writes to neither, so it is
 * safe against production at any time and is the intended first step of a
 * rehearsal. Exits non-zero if anything blocking is found, so a cutover script
 * can refuse to continue.
 */
class PreflightSupabaseImport extends Command
{
    protected $signature = 'omnipos:preflight-supabase
        {--json : Emit findings as JSON for a report or a CI job}
        {--examples : Show example rows for every finding}';

    protected $description = 'Report what would fail before importing from Supabase. Reads only.';

    public function handle(SupabasePreflight $preflight): int
    {
        try {
            DB::connection('supabase')->getPdo();
        } catch (Throwable $e) {
            $this->error('Could not connect to the Supabase source: '.$e->getMessage());
            $this->line('Set the supabase connection in config/database.php and the SUPABASE_* variables in .env.');

            return self::FAILURE;
        }

        $findings = $preflight->run();

        if ($this->option('json')) {
            $this->line(json_encode([
                'checked_at' => now()->toIso8601String(),
                'blocking' => $preflight->blocking($findings),
                'findings' => $findings,
            ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));

            return $preflight->blocking($findings) > 0 ? self::FAILURE : self::SUCCESS;
        }

        $this->newLine();

        if ($findings === []) {
            $this->info('Nothing to report. Every row in Supabase can land in this schema.');

            return self::SUCCESS;
        }

        foreach ([
            SupabasePreflight::BLOCKING => ['BLOCKING — these rows cannot be imported', 'error'],
            SupabasePreflight::ALTERED => ['ALTERED — these import, but not unchanged', 'warn'],
            SupabasePreflight::NOTE => ['WORTH KNOWING', 'line'],
        ] as $grade => [$heading, $style]) {
            $group = array_values(array_filter($findings, fn ($f) => $f['grade'] === $grade));

            if ($group === []) {
                continue;
            }

            $this->{$style === 'error' ? 'error' : ($style === 'warn' ? 'warn' : 'info')}($heading);

            foreach ($group as $finding) {
                $this->line(sprintf('  %-18s %6d  %s', $finding['area'], $finding['count'], $finding['detail']));

                if ($this->option('examples') && $finding['examples'] !== []) {
                    foreach ($finding['examples'] as $example) {
                        $this->line('                              '.json_encode($example, JSON_UNESCAPED_SLASHES));
                    }
                }
            }

            $this->newLine();
        }

        $blocking = $preflight->blocking($findings);

        if ($blocking > 0) {
            $this->error("{$blocking} blocking problem(s). Fix these in Supabase, or decide what happens to those rows, before importing.");
            $this->line('Run with --examples to see the rows themselves.');

            return self::FAILURE;
        }

        $this->info('Nothing blocking. Read the notes above, then rehearse the import against a copy.');

        return self::SUCCESS;
    }
}

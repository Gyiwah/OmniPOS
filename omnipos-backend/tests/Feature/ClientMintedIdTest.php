<?php

namespace Tests\Feature;

use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * The identity policy, enforced mechanically.
 *
 * Clients mint UUIDv7 primary keys offline and the server accepts them verbatim
 * — that is what makes the sync push an idempotent upsert rather than a
 * reconciliation problem. Any model reached with a client-supplied id therefore
 * has to accept it as a fillable attribute.
 *
 * This test exists because the same omission has now shipped three times, on
 * Product, on Customer and on ProductBatch. Each time the symptom was identical
 * and quiet: updating an existing record worked, creating a new one threw a mass
 * assignment error, and every test stayed green because they all edited rows the
 * fixtures had already made. In the field it meant no till could add a product,
 * register a customer, or record a delivery.
 *
 * Scanning the source rather than exercising each handler is deliberate. The
 * failure is an absent line in a model, and a behavioural test only catches it
 * for the one path someone thought to write.
 */
class ClientMintedIdTest extends TestCase
{
    /** Where a client id reaches a model. */
    private const ASSIGNMENT_PATTERN = '/(\w+)::(?:withTrashed\(\)->)?firstOrNew\(\[\s*[\'"]id[\'"]/';

    private function sourceFiles(string $directory): array
    {
        $files = [];

        $iterator = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator(app_path($directory), \FilesystemIterator::SKIP_DOTS)
        );

        foreach ($iterator as $file) {
            if ($file->getExtension() === 'php') {
                $files[$file->getPathname()] = file_get_contents($file->getPathname());
            }
        }

        return $files;
    }

    public function test_every_model_given_a_client_minted_id_accepts_it(): void
    {
        $offenders = [];
        $checked = 0;

        foreach ($this->sourceFiles('Services/Sync') as $path => $source) {
            preg_match_all(self::ASSIGNMENT_PATTERN, $source, $matches);

            foreach ($matches[1] as $model) {
                $checked++;
                $modelFile = app_path("Models/{$model}.php");

                if (! file_exists($modelFile)) {
                    $offenders[] = "{$model} (referenced in ".basename($path).") has no model file";

                    continue;
                }

                $fillable = $this->fillableOf(file_get_contents($modelFile));

                if (! in_array('id', $fillable, true)) {
                    $offenders[] = "{$model} is given a client id in ".basename($path)." but 'id' is not fillable";
                }
            }
        }

        $this->assertGreaterThan(0, $checked, 'the scan matched nothing, which means the pattern has drifted');
        $this->assertSame([], $offenders);
    }

    /**
     * The same omission, one layer up: a controller that validates an optional
     * `id` and hands it to create() fails exactly as a handler does.
     */
    public function test_every_controller_accepting_an_id_writes_to_a_model_that_allows_it(): void
    {
        $offenders = [];

        foreach ($this->sourceFiles('Http/Controllers') as $path => $source) {
            if (! preg_match('/[\'"]id[\'"]\s*=>\s*\[\s*[\'"]sometimes[\'"]/', $source)) {
                continue;
            }

            // The model is whatever this controller calls ::create on.
            if (! preg_match('/(\w+)::create\(/', $source, $match)) {
                continue;
            }

            $modelFile = app_path("Models/{$match[1]}.php");
            if (! file_exists($modelFile)) {
                continue;
            }

            if (! in_array('id', $this->fillableOf(file_get_contents($modelFile)), true)) {
                $offenders[] = "{$match[1]} takes a client id in ".basename($path)." but 'id' is not fillable";
            }
        }

        $this->assertSame([], $offenders);
    }

    /**
     * Models whose ids are always server-generated must NOT be widened.
     *
     * Nothing hands these a client id, and making one fillable would let a
     * request choose its own primary key — for User that is the difference
     * between creating an account and overwriting somebody else's.
     */
    public function test_identity_models_do_not_accept_a_client_supplied_id(): void
    {
        foreach (['User', 'StoreMember', 'StoreInvite'] as $model) {
            $fillable = $this->fillableOf(file_get_contents(app_path("Models/{$model}.php")));

            $this->assertNotContains('id', $fillable, "{$model} must not let a request choose its own id");
        }
    }

    /** A real record, to prove the scan is testing something that actually holds. */
    public function test_a_batch_can_be_created_with_a_client_supplied_id(): void
    {
        $store = \App\Models\Store::create([
            'name' => 'T', 'owner_user_id' => \App\Models\User::create([
                'name' => 'U', 'email' => Str::uuid7().'@test', 'password' => 'x',
            ])->id,
        ]);

        $product = \App\Models\Product::create([
            'store_id' => $store->id, 'name' => 'W', 'sku' => 'W-'.Str::random(5), 'price' => 1,
        ]);

        $id = (string) Str::uuid7();

        $batch = \App\Models\ProductBatch::withTrashed()->firstOrNew(['id' => $id]);
        $batch->forceFill([
            'id' => $id, 'store_id' => $store->id, 'product_id' => $product->id,
            'batch_number' => 'B-'.Str::random(5), 'quantity' => 5,
        ])->save();

        $this->assertSame($id, \App\Models\ProductBatch::find($id)?->id);
    }

    /** @return array<int, string> */
    private function fillableOf(string $source): array
    {
        if (! preg_match('/protected \$fillable = \[(.*?)\];/s', $source, $match)) {
            return [];
        }

        preg_match_all('/[\'"]([a-z_]+)[\'"]/', $match[1], $fields);

        return $fields[1];
    }
}

<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\Store;
use App\Models\StoreMember;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Images replace a Supabase bucket that was protected by RLS on
 * storage.objects. Nothing enforces that now except this controller, so the
 * access checks matter more than the upload mechanics.
 */
class MediaTest extends TestCase
{
    use DatabaseTransactions;

    private Store $store;
    private User $manager;
    private User $cashier;
    private Product $product;

    protected function setUp(): void
    {
        parent::setUp();

        Storage::fake('local');

        $this->manager = $this->makeUser();
        $this->cashier = $this->makeUser();
        $this->store = Store::create(['name' => 'S', 'owner_user_id' => $this->manager->id]);

        StoreMember::create([
            'store_id' => $this->store->id, 'user_id' => $this->manager->id, 'role' => StoreMember::ROLE_MANAGER,
        ]);
        StoreMember::create([
            'store_id' => $this->store->id, 'user_id' => $this->cashier->id, 'role' => StoreMember::ROLE_CASHIER,
        ]);

        $this->product = Product::create([
            'store_id' => $this->store->id, 'name' => 'Widget', 'sku' => 'M-'.Str::random(5),
            'price' => 10, 'stock' => 0,
        ]);
    }

    private function makeUser(): User
    {
        return User::create([
            'name' => 'U', 'email' => Str::uuid7().'@test', 'password' => Hash::make('password'),
        ]);
    }

    private function as(User $user)
    {
        // Accept: application/json so a validation failure comes back as 422
        // rather than the redirect a browser form post would get.
        return $this->actingAs($user)->withHeaders([
            'X-Store-Id' => $this->store->id,
            'Accept' => 'application/json',
        ]);
    }

    public function test_a_manager_uploads_a_product_image_to_a_store_scoped_path(): void
    {
        $response = $this->as($this->manager)->post('/api/media', [
            'file' => UploadedFile::fake()->image('widget.jpg'),
            'kind' => 'product',
            'product_id' => $this->product->id,
        ])->assertCreated();

        $path = $response->json('path');

        // The store id prefix IS the authorisation boundary on read.
        $this->assertSame("{$this->store->id}/products/{$this->product->id}.jpg", $path);
        $this->assertSame($path, $this->product->refresh()->image_url);
        Storage::disk('local')->assertExists($path);
    }

    /** Re-uploading replaces rather than accumulating orphans nothing cleans up. */
    public function test_re_uploading_replaces_the_same_object(): void
    {
        $first = $this->as($this->manager)->post('/api/media', [
            'file' => UploadedFile::fake()->image('a.jpg'),
            'kind' => 'product', 'product_id' => $this->product->id,
        ])->json('path');

        $second = $this->as($this->manager)->post('/api/media', [
            'file' => UploadedFile::fake()->image('b.jpg'),
            'kind' => 'product', 'product_id' => $this->product->id,
        ])->json('path');

        $this->assertSame($first, $second);
        $this->assertCount(1, Storage::disk('local')->files("{$this->store->id}/products"));
    }

    public function test_a_cashier_cannot_upload(): void
    {
        $this->as($this->cashier)->post('/api/media', [
            'file' => UploadedFile::fake()->image('x.jpg'),
            'kind' => 'product', 'product_id' => $this->product->id,
        ])->assertForbidden();
    }

    public function test_a_member_can_read_an_image_from_their_own_store(): void
    {
        $path = $this->as($this->manager)->post('/api/media', [
            'file' => UploadedFile::fake()->image('w.jpg'),
            'kind' => 'product', 'product_id' => $this->product->id,
        ])->json('path');

        // Browser <img> and native image requests cannot attach X-Store-Id.
        $this->actingAs($this->cashier)->withHeader('Accept', 'application/json')
            ->get('/api/media/'.$path)->assertOk();
    }

    /**
     * The check the Supabase bucket used to make. Without it, a path is enough
     * to read another shop's catalogue images.
     */
    public function test_a_non_member_cannot_read_another_stores_image(): void
    {
        $path = $this->as($this->manager)->post('/api/media', [
            'file' => UploadedFile::fake()->image('w.jpg'),
            'kind' => 'product', 'product_id' => $this->product->id,
        ])->json('path');

        $outsider = $this->makeUser();

        // 404 rather than 403: confirming the object exists already leaks it.
        $this->actingAs($outsider)->withHeader('Accept', 'application/json')
            ->get('/api/media/'.$path)->assertNotFound();
    }

    public function test_path_traversal_is_refused(): void
    {
        $this->as($this->manager)
            ->get('/api/media/'.$this->store->id.'/../../.env')
            ->assertStatus(400);
    }

    public function test_a_logo_upload_records_the_path_on_the_store(): void
    {
        $path = $this->as($this->manager)->post('/api/media/store-logo', [
            'file' => UploadedFile::fake()->image('logo.png'),
            'kind' => 'logo',
        ])->assertCreated()->json('path');

        $this->assertSame("{$this->store->id}/branding/logo.png", $path);
        $this->assertSame($path, $this->store->refresh()->logo_url);
    }

    public function test_a_non_image_is_rejected(): void
    {
        $this->as($this->manager)->post('/api/media', [
            'file' => UploadedFile::fake()->create('payload.php', 10, 'application/x-php'),
            'kind' => 'product', 'product_id' => $this->product->id,
        ])->assertStatus(422);
    }

    public function test_a_product_from_another_store_cannot_be_targeted(): void
    {
        $outsider = $this->makeUser();
        $otherStore = Store::create(['name' => 'Other', 'owner_user_id' => $outsider->id]);
        $foreign = Product::create([
            'store_id' => $otherStore->id, 'name' => 'Secret', 'sku' => 'F-'.Str::random(5),
            'price' => 1, 'stock' => 0,
        ]);

        $this->as($this->manager)->post('/api/media', [
            'file' => UploadedFile::fake()->image('x.jpg'),
            'kind' => 'product', 'product_id' => $foreign->id,
        ])->assertNotFound();
    }
}

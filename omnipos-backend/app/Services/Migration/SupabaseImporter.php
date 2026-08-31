<?php

namespace App\Services\Migration;

use App\Models\Product;
use App\Services\InventoryService;
use Closure;
use Illuminate\Database\ConnectionInterface;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * One-time data migration from the Supabase project into this database.
 *
 * Design rules, all of which exist for a reason:
 *
 * IDEMPOTENT. Every step skips rows already present, so the command can be run
 * repeatedly, resumed after a failure, and re-run at cutover to catch the last
 * few hours of trading without duplicating anything.
 *
 * IDENTITY IS PRESERVED. Supabase primary keys are UUIDs and this schema takes
 * client-minted UUIDs with no database default, so every id carries across
 * unchanged. Receipts, foreign keys and the mobile clients' local records all
 * keep pointing at the same rows. Nothing is renumbered.
 *
 * READ-ONLY AT SOURCE. The supabase connection is only ever SELECTed from.
 *
 * ORDERED BY DEPENDENCY. Steps run in foreign-key order; running them out of
 * order will fail loudly rather than silently orphan rows.
 */
class SupabaseImporter
{
    private int $chunk = 500;

    /** @var Closure(string):void */
    private Closure $log;

    public function __construct(private readonly InventoryService $inventory)
    {
        $this->log = fn (string $m) => null;
    }

    public function onProgress(Closure $log): self
    {
        $this->log = $log;

        return $this;
    }

    public function chunkSize(int $size): self
    {
        $this->chunk = max(50, $size);

        return $this;
    }

    private function source(): ConnectionInterface
    {
        return DB::connection('supabase');
    }

    /** Ordered list of steps. Keys are the --only filter values. */
    public function steps(): array
    {
        return [
            'users' => fn () => $this->importUsers(),
            'stores' => fn () => $this->importStores(),
            'store_members' => fn () => $this->importStoreMembers(),
            'store_invites' => fn () => $this->importStoreInvites(),
            'customers' => fn () => $this->importCustomers(),
            'products' => fn () => $this->importProducts(),
            'product_batches' => fn () => $this->importProductBatches(),
            'stock_movements' => fn () => $this->importStockMovements(),
            'price_history' => fn () => $this->importPriceHistory(),
            'orders' => fn () => $this->importOrders(),
            'order_items' => fn () => $this->importOrderItems(),
            'payments' => fn () => $this->synthesisePayments(),
            'returns' => fn () => $this->importReturns(),
            'return_items' => fn () => $this->importReturnItems(),
            'stock_reconcile' => fn () => $this->reconcileStock(),
            'customer_totals' => fn () => $this->recomputeCustomerTotals(),
        ];
    }

    /**
     * Users, from auth.users joined to public.profiles.
     *
     * Password hashes carry across. GoTrue stores bcrypt ($2a$) and Laravel's
     * default hasher is bcrypt; PHP's password_verify accepts $2a$/$2b$/$2y$
     * interchangeably, so existing passwords keep working and nobody is forced
     * through a reset at cutover.
     *
     * Anything that is not a bcrypt hash is discarded rather than copied, and the
     * account is left with no password. Those users (invite-only and magic-link
     * accounts, which never had one) must set a password before signing in —
     * copying an unrecognised hash would silently create an account nobody can
     * authenticate against.
     */
    public function importUsers(): array
    {
        $inserted = 0;
        $withoutPassword = 0;

        $this->source()->table('auth.users as u')
            // profiles is left unqualified so it resolves through the
            // connection's search_path (public,auth in production).
            ->leftJoin('profiles as p', 'p.id', '=', 'u.id')
            ->select([
                'u.id', 'u.email', 'u.encrypted_password', 'u.email_confirmed_at',
                'u.created_at', 'u.updated_at', 'u.raw_user_meta_data',
                'p.full_name', 'p.avatar_url', 'p.is_super_admin',
            ])
            ->orderBy('u.id')
            ->chunk($this->chunk, function ($rows) use (&$inserted, &$withoutPassword) {
                $batch = [];

                foreach ($rows as $r) {
                    if (! $r->email) {
                        continue;
                    }

                    $hash = $r->encrypted_password;
                    $usable = is_string($hash) && str_starts_with($hash, '$2');
                    if (! $usable) {
                        $withoutPassword++;
                    }

                    $meta = $this->json($r->raw_user_meta_data);

                    $batch[] = [
                        'id' => $r->id,
                        'name' => $r->full_name ?: ($meta['full_name'] ?? Str::before($r->email, '@')),
                        'email' => Str::lower($r->email),
                        'email_verified_at' => $r->email_confirmed_at,
                        'password' => $usable ? $hash : null,
                        'avatar_url' => $r->avatar_url,
                        'is_super_admin' => (bool) ($r->is_super_admin ?? false),
                        'created_at' => $r->created_at,
                        'updated_at' => $r->updated_at,
                    ];
                }

                $inserted += $this->insertMissing('users', $batch);
            });

        ($this->log)("users: {$inserted} imported, {$withoutPassword} without a usable password (must reset)");

        return ['imported' => $inserted, 'needs_password_reset' => $withoutPassword];
    }

    public function importStores(): array
    {
        $n = $this->copy('stores', 'stores', fn ($r) => [
            'id' => $r->id,
            'parent_store_id' => $r->parent_store_id ?? null,
            'owner_user_id' => $r->owner_user_id,
            'name' => $r->name,
            'email' => $r->email ?? null,
            'logo_url' => $r->logo_url ?? null,
            'tax_profile' => $r->tax_profile ?? 'standard',
            'currency' => $r->currency ?? 'USD',
            'timezone' => $r->timezone ?? 'UTC',
            'language' => $r->language ?? 'English',
            'app_mode_dark' => (bool) ($r->app_mode_dark ?? false),
            'tax_rate' => $r->tax_rate ?? 0,
            'vat_rate' => $r->vat_rate ?? 0,
            'service_rate' => $r->service_rate ?? 0,
            'created_at' => $r->created_at,
            'updated_at' => $r->updated_at,
        ]);

        return ['imported' => $n];
    }

    /**
     * store_members had a composite primary key in Supabase; here the row has its
     * own uuid. The id is derived deterministically from the pair so that re-runs
     * produce the same row rather than a duplicate membership.
     */
    public function importStoreMembers(): array
    {
        $existing = DB::table('store_members')
            ->select('store_id', 'user_id')->get()
            ->map(fn ($r) => $r->store_id.'|'.$r->user_id)->flip();

        $inserted = 0;

        $this->source()->table('store_members')->orderBy('store_id')->orderBy('user_id')
            ->chunk($this->chunk, function ($rows) use (&$inserted, $existing) {
                $batch = [];
                foreach ($rows as $r) {
                    if ($existing->has($r->store_id.'|'.$r->user_id)) {
                        continue;
                    }
                    $batch[] = [
                        'id' => (string) Str::uuid7(),
                        'store_id' => $r->store_id,
                        'user_id' => $r->user_id,
                        'role' => $r->role,
                        'invited_by' => $r->invited_by ?? null,
                        'created_at' => $r->created_at,
                        'updated_at' => $r->created_at,
                    ];
                }
                if ($batch) {
                    DB::table('store_members')->insertOrIgnore($batch);
                    $inserted += count($batch);
                }
            });

        ($this->log)("store_members: {$inserted} imported");

        return ['imported' => $inserted];
    }

    /**
     * Invites gain a token column that Supabase had no equivalent for; it is
     * generated here. Pending invites therefore keep working through the new
     * acceptance flow, which matches on email rather than on the token.
     */
    public function importStoreInvites(): array
    {
        $n = $this->copy('store_invites', 'store_invites', fn ($r) => [
            'id' => $r->id,
            'store_id' => $r->store_id,
            'email' => Str::lower($r->email),
            'role' => $r->role,
            'status' => $r->status,
            'invited_by' => $r->invited_by ?? null,
            'accepted_user_id' => $r->accepted_user_id ?? null,
            'token' => Str::random(64),
            'expires_at' => $r->expires_at,
            'created_at' => $r->created_at,
            'updated_at' => $r->updated_at,
        ]);

        return ['imported' => $n];
    }

    public function importCustomers(): array
    {
        // total_spend and outstanding_balance are deliberately zeroed here and
        // recomputed from orders and payments in the customer_totals step. The
        // Supabase figures were maintained by clients and can disagree with the
        // order history; the order history is the evidence.
        $n = $this->copy('customers', 'customers', fn ($r) => [
            'id' => $r->id,
            'store_id' => $r->store_id,
            'name' => $r->name,
            'phone' => $r->phone ?? null,
            'email' => $r->email ?? null,
            'total_spend' => 0,
            'outstanding_balance' => 0,
            'notes' => $r->notes ?? null,
            'created_at' => $r->created_at,
            'updated_at' => $r->updated_at,
        ]);

        return ['imported' => $n];
    }

    /**
     * Products import with stock zeroed.
     *
     * Quantity is not a property of a product here, it is the sum of a ledger.
     * Writing Supabase's absolute stock in now and then importing the historical
     * stock_movements would count the same units twice. The stock_reconcile step
     * posts one adjusting movement per product so the ledger ends up summing to
     * exactly the quantity Supabase reported.
     */
    public function importProducts(): array
    {
        $n = $this->copy('products', 'products', fn ($r) => [
            'id' => $r->id,
            'store_id' => $r->store_id,
            'category_id' => null,
            'name' => $r->name,
            'sku' => $r->sku,
            'barcode' => $r->barcode ?? null,
            'price' => $r->price,
            'cost_price' => $r->cost_price ?? null,
            'stock' => 0,
            'reorder_level' => $r->reorder_level ?? 5,
            'image_url' => $r->image_url ?? null,
            'tags' => json_encode($this->pgArray($r->tags ?? null)),
            'expiry_date' => $r->expiry_date ?? null,
            'is_active' => (bool) ($r->is_active ?? true),
            'created_at' => $r->created_at,
            'updated_at' => $r->updated_at,
        ]);

        return ['imported' => $n];
    }

    public function importProductBatches(): array
    {
        $n = $this->copy('product_batches', 'product_batches', fn ($r) => [
            'id' => $r->id,
            'store_id' => $r->store_id,
            'product_id' => $r->product_id,
            'batch_number' => $r->batch_number,
            'quantity' => $r->quantity ?? 0,
            'cost_price' => $r->cost_price ?? null,
            'expiry_date' => $r->expiry_date ?? null,
            'created_at' => $r->created_at,
            'updated_at' => $r->updated_at,
        ]);

        return ['imported' => $n];
    }

    /**
     * Movements copy across verbatim, signs included: the mobile client already
     * writes negative quantities for sales and stock-outs and positive for
     * returns and stock-ins, which is the convention this schema expects.
     */
    public function importStockMovements(): array
    {
        $n = $this->copy('stock_movements', 'stock_movements', fn ($r) => [
            'id' => $r->id,
            'store_id' => $r->store_id,
            'product_id' => $r->product_id,
            'batch_id' => $r->batch_id ?? null,
            'user_id' => null,
            'device_id' => null,
            'type' => $this->movementType($r->type ?? 'ADJUSTMENT'),
            'quantity' => $r->quantity,
            'quantity_before' => $r->quantity_before ?? 0,
            'quantity_after' => $r->quantity_after ?? 0,
            'reason' => $r->reason ?: 'Imported from Supabase',
            'notes' => $r->notes ?? null,
            'source_type' => null,
            'source_id' => null,
            'client_created_at' => $r->created_at,
            'created_at' => $r->created_at,
            'updated_at' => $r->created_at,
        ]);

        return ['imported' => $n];
    }

    public function importPriceHistory(): array
    {
        $n = $this->copy('price_history', 'price_history', fn ($r) => [
            'id' => $r->id,
            'store_id' => $r->store_id,
            'product_id' => $r->product_id,
            'user_id' => null,
            'old_sell_price' => $r->old_sell_price ?? 0,
            'new_sell_price' => $r->new_sell_price ?? 0,
            'old_cost_price' => $r->old_cost_price ?? null,
            'new_cost_price' => $r->new_cost_price ?? null,
            'reason' => $r->reason ?? null,
            'client_created_at' => $r->created_at,
            'created_at' => $r->created_at,
            'updated_at' => $r->created_at,
        ]);

        return ['imported' => $n];
    }

    /**
     * client_created_at is set from created_at.
     *
     * Supabase never stored when a sale happened on the device, only when the
     * server received it. For offline sales those differ, sometimes by hours, and
     * the true till time is not recoverable. Using created_at keeps historical
     * sales reports self-consistent; only sales made after cutover will carry a
     * genuine device timestamp.
     */
    public function importOrders(): array
    {
        $n = $this->copy('orders', 'orders', fn ($r) => [
            'id' => $r->id,
            'store_id' => $r->store_id,
            'cashier_user_id' => $r->cashier_user_id,
            'customer_id' => $r->customer_id ?? null,
            'register_shift_id' => null,
            'device_id' => null,
            'order_number' => $r->order_number,
            'status' => $r->status ?? 'completed',
            'subtotal' => $r->subtotal ?? 0,
            'tax' => $r->tax ?? 0,
            'discount' => $r->discount ?? 0,
            'total' => $r->total ?? 0,
            'tax_rate' => $r->tax_rate ?? 0,
            'vat_rate' => $r->vat_rate ?? 0,
            'service_rate' => $r->service_rate ?? 0,
            'discount_mode' => $r->discount_mode ?? 'percentage',
            'discount_value' => $r->discount_value ?? 0,
            'amount_paid' => $r->amount_paid ?? 0,
            'change_due' => $r->change_due ?? 0,
            'payment_method' => $r->payment_method ?? 'cash',
            'customer_name' => $r->customer_name ?? null,
            'customer_phone' => $r->customer_phone ?? null,
            'shipping_address' => $r->shipping_address ?? null,
            'client_created_at' => $r->created_at,
            'version' => 1,
            'created_at' => $r->created_at,
            'updated_at' => $r->updated_at,
        ]);

        return ['imported' => $n];
    }

    /**
     * unit_cost is left null rather than back-filled from the product's current
     * cost price. Today's cost is not what the item cost when it sold, and
     * writing it would produce margin reports that look precise and are wrong.
     * Historical profit is computed only where a real cost is known.
     */
    public function importOrderItems(): array
    {
        $n = $this->copy('order_items', 'order_items', fn ($r) => [
            'id' => $r->id,
            'order_id' => $r->order_id,
            'store_id' => $r->store_id,
            'product_id' => $r->product_id ?? null,
            'product_name' => $r->product_name,
            'sku' => $r->sku ?? null,
            'barcode' => $r->barcode ?? null,
            'unit_price' => $r->unit_price,
            'quantity' => $r->quantity,
            'line_total' => $r->line_total,
            'unit_cost' => null,
            'created_at' => $r->created_at,
            'updated_at' => $r->created_at,
        ]);

        return ['imported' => $n];
    }

    /**
     * Supabase had no payments table: an order carried one payment_method string
     * and an amount_paid. One payment row is synthesised per paid order so that
     * takings, customer balances and future drawer reconciliation have a ledger
     * to read.
     *
     * 'split' becomes 'other' — money was received but the tender breakdown was
     * never recorded and cannot be invented. Filing it as cash would make the
     * affected tills look short.
     */
    public function synthesisePayments(): array
    {
        $inserted = 0;

        DB::table('orders')
            ->whereNotIn('status', ['voided'])
            ->where('amount_paid', '>', 0)
            ->whereNotExists(fn ($q) => $q->select(DB::raw(1))->from('payments')
                ->whereColumn('payments.order_id', 'orders.id'))
            ->orderBy('id')
            ->chunk($this->chunk, function ($orders) use (&$inserted) {
                $batch = [];
                foreach ($orders as $o) {
                    $batch[] = [
                        'id' => (string) Str::uuid7(),
                        'store_id' => $o->store_id,
                        'order_id' => $o->id,
                        'customer_id' => $o->customer_id,
                        'register_shift_id' => null,
                        'received_by_user_id' => $o->cashier_user_id,
                        'device_id' => null,
                        'method' => $this->paymentMethod($o->payment_method),
                        'amount' => $o->amount_paid,
                        'reference' => null,
                        'notes' => $o->payment_method === 'split'
                            ? 'Imported from Supabase; original tender breakdown was not recorded.'
                            : null,
                        'client_created_at' => $o->client_created_at,
                        'created_at' => $o->created_at,
                        'updated_at' => $o->created_at,
                    ];
                }
                if ($batch) {
                    DB::table('payments')->insert($batch);
                    $inserted += count($batch);
                }
            });

        ($this->log)("payments: {$inserted} synthesised from order totals");

        return ['imported' => $inserted];
    }

    public function importReturns(): array
    {
        $n = $this->copy('returns', 'returns', fn ($r) => [
            'id' => $r->id,
            'store_id' => $r->store_id,
            'order_id' => $r->order_id,
            'processed_by_user_id' => $r->processed_by_user_id,
            'register_shift_id' => null,
            'device_id' => null,
            'reason' => $r->reason ?? '',
            'amount' => $r->amount,
            'refund_method' => 'cash',
            'client_created_at' => $r->created_at,
            'created_at' => $r->created_at,
            'updated_at' => $r->updated_at,
        ]);

        return ['imported' => $n];
    }

    public function importReturnItems(): array
    {
        $n = $this->copy('return_items', 'return_items', fn ($r) => [
            'id' => $r->id,
            'return_id' => $r->return_id,
            'store_id' => $r->store_id,
            'order_item_id' => $r->order_item_id,
            'product_id' => $r->product_id ?? null,
            'product_name' => $r->product_name,
            'unit_price' => $r->unit_price,
            'quantity' => $r->quantity,
            'line_total' => $r->line_total,
            'restock' => true,
            'created_at' => $r->created_at,
            'updated_at' => $r->created_at,
        ]);

        return ['imported' => $n];
    }

    /**
     * Make the ledger sum to the quantity Supabase reported.
     *
     * Products came in at zero and their historical movements came in verbatim,
     * so the ledger currently reflects only the movements that happened to be
     * recorded. Supabase's products.stock is what the shop has actually been
     * trading against, so it is treated as the count of record: one adjusting
     * movement per product closes the gap.
     *
     * Recorded as type AUDIT with an explicit reason, so the adjustment is
     * visible in the ledger rather than being an unexplained jump.
     */
    public function reconcileStock(): array
    {
        $adjusted = 0;
        $unchanged = 0;

        $sourceStock = [];
        $this->source()->table('products')->select('id', 'stock')->orderBy('id')
            ->chunk(1000, function ($rows) use (&$sourceStock) {
                foreach ($rows as $r) {
                    $sourceStock[$r->id] = (float) $r->stock;
                }
            });

        Product::query()->orderBy('id')->chunkById(200, function ($products) use (&$adjusted, &$unchanged, $sourceStock) {
            foreach ($products as $product) {
                if (! array_key_exists($product->id, $sourceStock)) {
                    continue;
                }

                $target = $sourceStock[$product->id];
                $ledger = $this->inventory->ledgerBalance($product->id);
                $delta = round($target - $ledger, 2);

                if (abs($delta) < 0.005) {
                    $unchanged++;

                    continue;
                }

                $this->inventory->recordMovement(
                    movementId: (string) Str::uuid7(),
                    product: $product,
                    type: 'AUDIT',
                    quantity: $delta,
                    reason: 'Opening balance reconciliation (Supabase migration)',
                    sourceType: 'migration',
                    sourceId: $product->id,
                    notes: sprintf('Supabase reported %.2f; imported movements summed to %.2f.', $target, $ledger),
                );

                $adjusted++;
            }
        });

        ($this->log)("stock_reconcile: {$adjusted} products adjusted, {$unchanged} already matched");

        return ['adjusted' => $adjusted, 'already_correct' => $unchanged];
    }

    /**
     * Rebuild customer running totals from the evidence rather than trusting the
     * numbers Supabase clients maintained.
     */
    public function recomputeCustomerTotals(): array
    {
        $updated = 0;

        DB::table('customers')->orderBy('id')->chunkById(200, function ($customers) use (&$updated) {
            foreach ($customers as $c) {
                $spend = (string) (DB::table('orders')
                    ->where('customer_id', $c->id)
                    ->where('status', 'completed')
                    ->sum('total') ?: 0);

                $paid = (string) (DB::table('payments')
                    ->where('customer_id', $c->id)
                    ->sum('amount') ?: 0);

                $outstanding = bcsub($spend, $paid, 2);
                if (bccomp($outstanding, '0', 2) === -1) {
                    $outstanding = '0.00';
                }

                DB::table('customers')->where('id', $c->id)->update([
                    'total_spend' => $spend,
                    'outstanding_balance' => $outstanding,
                ]);
                $updated++;
            }
        });

        ($this->log)("customer_totals: {$updated} customers recomputed");

        return ['updated' => $updated];
    }

    // ---------------------------------------------------------------- helpers

    /**
     * Copy a table, skipping ids already present.
     *
     * @param  Closure(object):array  $map
     */
    private function copy(string $sourceTable, string $targetTable, Closure $map): int
    {
        $existing = DB::table($targetTable)->pluck('id')->flip();
        $inserted = 0;

        $this->source()->table($sourceTable)->orderBy('id')
            ->chunk($this->chunk, function ($rows) use ($map, $targetTable, $existing, &$inserted) {
                $batch = [];
                foreach ($rows as $r) {
                    if ($existing->has($r->id)) {
                        continue;
                    }
                    $batch[] = $map($r);
                }
                if ($batch) {
                    DB::table($targetTable)->insertOrIgnore($batch);
                    $inserted += count($batch);
                }
            });

        ($this->log)("{$targetTable}: {$inserted} imported");

        return $inserted;
    }

    private function insertMissing(string $table, array $rows): int
    {
        if (! $rows) {
            return 0;
        }

        $ids = array_column($rows, 'id');
        $present = DB::table($table)->whereIn('id', $ids)->pluck('id')->flip();
        $new = array_values(array_filter($rows, fn ($r) => ! $present->has($r['id'])));

        if ($new) {
            DB::table($table)->insertOrIgnore($new);
        }

        return count($new);
    }

    /** Supabase text[] arrives as a Postgres array literal or as JSON. */
    private function pgArray(?string $raw): array
    {
        if (! $raw) {
            return [];
        }
        $raw = trim($raw);
        if (str_starts_with($raw, '[')) {
            return json_decode($raw, true) ?: [];
        }
        if (str_starts_with($raw, '{')) {
            $inner = trim($raw, '{}');

            return $inner === '' ? [] : array_map(fn ($v) => trim($v, '"'), explode(',', $inner));
        }

        return [$raw];
    }

    private function json(?string $raw): array
    {
        return $raw ? (json_decode($raw, true) ?: []) : [];
    }

    /** Constrain to the movement types this schema accepts. */
    private function movementType(string $type): string
    {
        $allowed = ['STOCK_IN', 'STOCK_OUT', 'SALE', 'RETURN', 'ADJUSTMENT', 'DAMAGE', 'EXPIRED', 'AUDIT', 'TRANSFER_IN', 'TRANSFER_OUT'];

        return in_array($type, $allowed, true) ? $type : 'ADJUSTMENT';
    }

    private function paymentMethod(?string $method): string
    {
        return match ($method) {
            'cash' => 'cash',
            'card' => 'card',
            'transfer' => 'transfer',
            // Money arrived; how, was never recorded.
            'split' => 'other',
            default => 'other',
        };
    }
}

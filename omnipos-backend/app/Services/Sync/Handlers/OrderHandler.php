<?php

namespace App\Services\Sync\Handlers;

use App\Models\Device;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Payment;
use App\Models\Product;
use App\Models\RegisterShift;
use App\Models\StoreMember;
use App\Models\User;
use App\Services\InventoryService;
use App\Services\Sync\EntityHandler;
use App\Services\Sync\UpsertOutcome;

/**
 * The most important handler: a pushed order is a completed sale that has already
 * been receipted on a device. It must land, or money goes missing from the books.
 *
 * One order push carries its lines, its tenders and its stock movements, and all
 * of them commit together inside the transaction SyncService opened. A sale whose
 * items landed but whose payments did not would corrupt both the day's takings
 * and the customer's balance.
 */
class OrderHandler implements EntityHandler
{
    public function __construct(private readonly InventoryService $inventory)
    {
    }

    public function authorize(User $user, string $storeId, string $action, array $payload): bool
    {
        if ($action === 'delete') {
            return $user->hasStoreRole($storeId, [StoreMember::ROLE_ADMIN, StoreMember::ROLE_MANAGER]);
        }

        return $user->hasStoreRole($storeId, [
            StoreMember::ROLE_ADMIN,
            StoreMember::ROLE_MANAGER,
            StoreMember::ROLE_CASHIER,
        ]);
    }

    public function upsert(string $storeId, string $recordId, array $payload, User $user, ?Device $device): UpsertOutcome
    {
        $existing = Order::withTrashed()->find($recordId);

        if ($existing && $existing->store_id !== $storeId) {
            return UpsertOutcome::conflict('Record belongs to a different store.');
        }

        // An order already on the server is a replay of a sale we have. Return it
        // unchanged rather than rebuilding lines and re-applying stock movements.
        if ($existing) {
            return UpsertOutcome::applied($this->present($existing));
        }

        $orderNumber = $payload['order_number'] ?? null;
        if (! $orderNumber) {
            return UpsertOutcome::conflict('order_number is required.');
        }

        $clash = Order::withTrashed()
            ->where('store_id', $storeId)
            ->where('order_number', $orderNumber)
            ->whereKeyNot($recordId)
            ->first();

        if ($clash) {
            // Two tills generated the same receipt number offline. Renumbering
            // server-side would break the paper receipt in the customer's hand,
            // so this is escalated rather than resolved automatically.
            return UpsertOutcome::conflict(
                "Order number [{$orderNumber}] already exists in this store.",
                ['id' => $clash->id, 'order_number' => $clash->order_number, 'total' => $clash->total]
            );
        }

        $stockConflict = $this->stockConflict($storeId, $payload['items'] ?? $payload['lines'] ?? []);
        if ($stockConflict) {
            return UpsertOutcome::conflict($stockConflict);
        }

        /*
         * A drawer this server does not know about attributes the sale to no
         * drawer, rather than refusing the sale.
         *
         * register_shift_id carries a foreign key, so an id the server has
         * never seen makes the whole push fail — and a till can easily hold
         * one: its shift may still be queued behind this order, or may have
         * been rejected outright because another shift was already open. Both
         * happen, and neither is a reason to lose a sale that has been rung up
         * and receipted.
         *
         * The cost of nulling it is that the sale is missing from one drawer
         * count. The cost of refusing it is a sale missing from the books.
         */
        $shiftId = $payload['register_shift_id'] ?? null;
        if ($shiftId && ! RegisterShift::where('store_id', $storeId)->whereKey($shiftId)->exists()) {
            $shiftId = null;
        }

        $order = new Order();
        $order->forceFill([
            'id' => $recordId,
            'store_id' => $storeId,
            'cashier_user_id' => $payload['cashier_user_id'] ?? $user->id,
            'customer_id' => $payload['customer_id'] ?? null,
            'register_shift_id' => $shiftId,
            'device_id' => $device?->id,
            'order_number' => $orderNumber,
            'status' => $payload['status'] ?? 'completed',
            'subtotal' => $payload['subtotal'] ?? 0,
            'tax' => $payload['tax'] ?? 0,
            'discount' => $payload['discount'] ?? 0,
            'total' => $payload['total'] ?? 0,
            'tax_rate' => $payload['tax_rate'] ?? 0,
            'vat_rate' => $payload['vat_rate'] ?? 0,
            'service_rate' => $payload['service_rate'] ?? 0,
            'discount_mode' => $payload['discount_mode'] ?? 'percentage',
            'discount_value' => $payload['discount_value'] ?? 0,
            'amount_paid' => $payload['amount_paid'] ?? 0,
            'change_due' => $payload['change_due'] ?? 0,
            'payment_method' => $payload['payment_method'] ?? 'cash',
            'customer_name' => $payload['customer_name'] ?? null,
            'customer_phone' => $payload['customer_phone'] ?? null,
            'shipping_address' => $payload['shipping_address'] ?? null,
            'client_created_at' => $payload['client_created_at'] ?? now(),
        ]);
        $order->save();

        $this->storeLines($order, $payload['items'] ?? $payload['lines'] ?? [], $user, $device);
        $this->storePayments($order, $payload, $user, $device);
        $this->refreshCustomerTotals($order);

        return UpsertOutcome::applied($this->present($order->fresh(['items', 'payments'])));
    }

    /** @param array<int, array<string, mixed>> $lines */
    private function stockConflict(string $storeId, array $lines): ?string
    {
        $requested = [];
        foreach ($lines as $line) {
            $productId = $line['product_id'] ?? null;
            $quantity = (int) ($line['quantity'] ?? 0);
            if ($productId && $quantity > 0) {
                $requested[$productId] = ($requested[$productId] ?? 0) + $quantity;
            }
        }

        foreach ($requested as $productId => $quantity) {
            $product = Product::where('store_id', $storeId)->whereKey($productId)->lockForUpdate()->first();
            if ($product && $quantity > (int) $product->stock) {
                return "Not enough stock for {$product->name}. Only {$product->stock} remain.";
            }
        }

        return null;
    }

    /** @param array<int, array<string, mixed>> $lines */
    private function storeLines(Order $order, array $lines, User $user, ?Device $device): void
    {
        foreach ($lines as $line) {
            $productId = $line['product_id'] ?? null;
            $quantity = (int) ($line['quantity'] ?? 0);

            if ($quantity <= 0) {
                continue;
            }

            $product = $productId ? Product::where('store_id', $order->store_id)->find($productId) : null;

            $item = OrderItem::create([
                'id' => $line['id'] ?? null,
                'order_id' => $order->id,
                'store_id' => $order->store_id,
                'product_id' => $product?->id,
                'product_name' => $line['product_name'] ?? $product?->name ?? 'Item',
                'sku' => $line['sku'] ?? $product?->sku,
                'barcode' => $line['barcode'] ?? $product?->barcode,
                'unit_price' => $line['unit_price'] ?? 0,
                'quantity' => $quantity,
                'line_total' => $line['line_total'] ?? 0,
                'unit_cost' => $line['unit_cost'] ?? $product?->cost_price,
            ]);

            if (! $product) {
                continue;
            }

            // The movement borrows the order line's id, which makes it
            // deterministic: recordMovement() is idempotent on that id, so
            // replaying this sale can never decrement stock a second time.
            $this->inventory->recordMovement(
                movementId: $item->id,
                product: $product,
                type: 'SALE',
                quantity: -$quantity,
                reason: "Sale {$order->order_number}",
                user: $user,
                device: $device,
                sourceType: 'order',
                sourceId: $order->id,
                clientCreatedAt: $order->client_created_at?->toDateTimeString(),
            );
        }
    }

    private function storePayments(Order $order, array $payload, User $user, ?Device $device): void
    {
        $splits = $payload['payments'] ?? $payload['payment_splits'] ?? null;

        // Legacy single-tender shape from the current mobile client: synthesise
        // one payment row so shift reconciliation and reporting see it.
        if (! $splits) {
            $paid = (float) ($payload['amount_paid'] ?? 0);
            if ($paid <= 0) {
                return;
            }
            $splits = [[
                'method' => $payload['payment_method'] ?? 'cash',
                'amount' => $paid,
            ]];
        }

        foreach ($splits as $split) {
            $amount = (float) ($split['amount'] ?? 0);
            if ($amount <= 0) {
                continue;
            }

            Payment::create([
                'id' => $split['id'] ?? null,
                'store_id' => $order->store_id,
                'order_id' => $order->id,
                'customer_id' => $order->customer_id,
                'register_shift_id' => $order->register_shift_id,
                'received_by_user_id' => $user->id,
                'device_id' => $device?->id,
                /*
                 * Normalised, and 'other' where it cannot be. A sale reaching
                 * this point happened: the customer paid and walked out. The
                 * unnormalised value went straight into a column with a check
                 * constraint, so a method this schema did not recognise — the
                 * mobile till's 'momo', for one — failed the whole push and
                 * left the sale off the books entirely.
                 */
                'method' => Payment::canonicalMethod($split['method'] ?? null) ?? 'other',
                'amount' => $amount,
                'reference' => $split['reference'] ?? null,
                'client_created_at' => $order->client_created_at,
            ]);
        }
    }

    /**
     * Recompute the customer's running totals from their orders and payments.
     * Never trusts a client-supplied balance.
     */
    private function refreshCustomerTotals(Order $order): void
    {
        if (! $order->customer_id) {
            return;
        }

        $customer = $order->customer()->lockForUpdate()->first();
        if (! $customer) {
            return;
        }

        $spend = (string) Order::where('customer_id', $customer->id)->completed()->sum('total');
        $paid = (string) Payment::where('customer_id', $customer->id)->sum('amount');
        $outstanding = bcsub($spend, $paid, 2);

        $customer->forceFill([
            'total_spend' => $spend,
            'outstanding_balance' => bccomp($outstanding, '0', 2) === 1 ? $outstanding : '0.00',
        ])->save();
    }

    private function present(Order $order): array
    {
        return $order->load(['items', 'payments'])->toArray();
    }

    public function delete(string $storeId, string $recordId, User $user, ?Device $device): UpsertOutcome
    {
        // Sales are never hard-deleted; they are voided so the audit trail and
        // the sequence of receipt numbers stay intact.
        $order = Order::where('store_id', $storeId)->find($recordId);

        if (! $order) {
            return UpsertOutcome::applied(['id' => $recordId, 'voided' => true]);
        }

        $order->forceFill(['status' => 'voided'])->save();

        return UpsertOutcome::applied(['id' => $recordId, 'voided' => true]);
    }
}

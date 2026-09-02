<?php

namespace App\Services\Sync\Handlers;

use App\Models\Device;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Payment;
use App\Models\Product;
use App\Models\ReturnItem;
use App\Models\SaleReturn;
use App\Models\StoreMember;
use App\Models\User;
use App\Services\CustomerLedger;
use App\Services\InventoryService;
use App\Services\Sync\EntityHandler;
use App\Services\Sync\UpsertOutcome;
use Illuminate\Support\Str;

/**
 * Refunds pushed from a till.
 *
 * A return moves money out of the drawer and stock back onto the shelf, so it
 * gets the same treatment as a sale: the lines, the restock movements and the
 * customer's balance all settle inside the one transaction SyncService opened.
 *
 * The eligibility check is the part that matters. A till decides what may be
 * returned from what it knows locally, which can be stale — another terminal may
 * have processed a return against the same sale while this one was offline. The
 * server re-checks against every return ever recorded, because otherwise a
 * customer can be refunded more than they paid by using two tills.
 */
class ReturnHandler implements EntityHandler
{
    public function __construct(
        private readonly InventoryService $inventory,
        private readonly CustomerLedger $ledger,
    ) {
    }

    public function authorize(User $user, string $storeId, string $action, array $payload): bool
    {
        if ($action === 'delete') {
            return false;
        }

        return $user->hasStoreRole($storeId, [
            StoreMember::ROLE_ADMIN,
            StoreMember::ROLE_MANAGER,
            StoreMember::ROLE_CASHIER,
        ]);
    }

    public function upsert(string $storeId, string $recordId, array $payload, User $user, ?Device $device): UpsertOutcome
    {
        $existing = SaleReturn::withTrashed()->find($recordId);

        if ($existing && $existing->store_id !== $storeId) {
            return UpsertOutcome::conflict('Record belongs to a different store.');
        }

        // Already processed. Replaying must not refund twice or restock twice.
        if ($existing) {
            return UpsertOutcome::applied($existing->load('items')->toArray());
        }

        $orderId = $payload['order_id'] ?? null;
        if (! $orderId) {
            return UpsertOutcome::conflict('order_id is required.');
        }

        $order = Order::forStore($storeId)->find($orderId);
        if (! $order) {
            return UpsertOutcome::conflict('The sale being returned is not on this server yet.', [
                'order_id' => $orderId,
            ]);
        }

        $lines = $payload['items'] ?? [];
        if (! $lines) {
            return UpsertOutcome::conflict('A return must have at least one line.');
        }

        $eligibility = $this->checkEligibility($storeId, $order, $lines);
        if ($eligibility !== null) {
            return $eligibility;
        }

        $return = new SaleReturn();
        $return->forceFill([
            'id' => $recordId,
            'store_id' => $storeId,
            'order_id' => $order->id,
            'processed_by_user_id' => $payload['processed_by_user_id'] ?? $user->id,
            'register_shift_id' => $payload['register_shift_id'] ?? null,
            'device_id' => $device?->id,
            'reason' => $payload['reason'] ?? '',
            'amount' => $payload['amount'] ?? 0,
            'refund_method' => $payload['refund_method'] ?? 'cash',
            'client_created_at' => $payload['client_created_at'] ?? now(),
        ]);
        $return->save();

        foreach ($lines as $line) {
            $quantity = (int) ($line['quantity'] ?? 0);
            if ($quantity <= 0) {
                continue;
            }

            /*
             * What was sold is settled by the order line, not by the client
             * repeating it. Eligibility has already proved this line belongs to
             * this sale, so the order item is here and is authoritative.
             *
             * It used to take product_id from the payload and skip the restock
             * silently when it was absent. A refund then paid the customer and
             * left the goods off the shelf for ever, with nothing anywhere
             * saying so — and a client sending the wrong id would have
             * restocked some other product instead.
             */
            $orderItem = OrderItem::where('store_id', $storeId)
                ->where('order_id', $order->id)
                ->find($line['order_item_id']);

            $item = ReturnItem::create([
                'id' => $line['id'] ?? null,
                'return_id' => $return->id,
                'store_id' => $storeId,
                'order_item_id' => $line['order_item_id'],
                'product_id' => $orderItem?->product_id ?? $line['product_id'] ?? null,
                'product_name' => $orderItem?->product_name ?? $line['product_name'] ?? 'Item',
                'unit_price' => $orderItem?->unit_price ?? $line['unit_price'] ?? 0,
                'quantity' => $quantity,
                'line_total' => $line['line_total'] ?? 0,
                'restock' => $line['restock'] ?? true,
            ]);

            if (! $item->restock) {
                continue;
            }

            /*
             * A sale line with no product is a one-off keyed into the till, and
             * a product since deleted cannot be restocked either. Both are
             * legitimate, and neither is silent: the money is still refunded,
             * and the return line records that no stock came back.
             */
            $product = $item->product_id
                ? Product::forStore($storeId)->find($item->product_id)
                : null;

            if (! $product) {
                continue;
            }

            // Goods coming back are a positive movement. Borrowing the line's id
            // makes it deterministic, so a replay cannot restock twice.
            $this->inventory->recordMovement(
                movementId: $item->id,
                product: $product,
                type: 'RETURN',
                quantity: (float) $quantity,
                reason: "Return against {$order->order_number}",
                user: $user,
                device: $device,
                sourceType: 'return',
                sourceId: $return->id,
                clientCreatedAt: $return->client_created_at?->toDateTimeString(),
            );
        }

        $this->recordRefund($return, $order, $user, $device);

        if ($order->customer) {
            $this->ledger->recompute($order->customer);
        }

        return UpsertOutcome::applied($return->fresh('items')->toArray());
    }

    /**
     * Refuse a return that would take back more than was sold.
     *
     * Counted across every return already recorded against each line, not just
     * the ones this till knows about. Two tills refunding the same items while
     * offline is exactly how a shop pays out twice for one sale.
     */
    private function checkEligibility(string $storeId, Order $order, array $lines): ?UpsertOutcome
    {
        foreach ($lines as $line) {
            $orderItemId = $line['order_item_id'] ?? null;
            $quantity = (int) ($line['quantity'] ?? 0);

            if (! $orderItemId) {
                return UpsertOutcome::conflict('Every return line must reference an order line.');
            }

            $orderItem = OrderItem::where('store_id', $storeId)
                ->where('order_id', $order->id)
                ->find($orderItemId);

            if (! $orderItem) {
                return UpsertOutcome::conflict('A returned line does not belong to this sale.', [
                    'order_item_id' => $orderItemId,
                ]);
            }

            $alreadyReturned = (int) ReturnItem::where('order_item_id', $orderItemId)->sum('quantity');
            $remaining = (int) $orderItem->quantity - $alreadyReturned;

            if ($quantity > $remaining) {
                return UpsertOutcome::conflict(
                    sprintf(
                        'Only %d of "%s" can still be returned; %d %s requested.',
                        max(0, $remaining),
                        $orderItem->product_name,
                        $quantity,
                        $quantity === 1 ? 'was' : 'were',
                    ),
                    [
                        'order_item_id' => $orderItemId,
                        'quantity_sold' => (int) $orderItem->quantity,
                        'quantity_returned' => $alreadyReturned,
                        'quantity_eligible' => max(0, $remaining),
                    ],
                );
            }
        }

        return null;
    }

    /**
     * A refund is money leaving, so it belongs in the payments ledger as a
     * negative amount rather than being implied by the return row. Otherwise the
     * drawer reconciles against sales alone and always looks over.
     */
    private function recordRefund(SaleReturn $return, Order $order, User $user, ?Device $device): void
    {
        $amount = (float) $return->amount;
        if ($amount <= 0) {
            return;
        }

        Payment::create([
            'id' => (string) Str::uuid7(),
            'store_id' => $return->store_id,
            'order_id' => $order->id,
            'customer_id' => $order->customer_id,
            'register_shift_id' => $return->register_shift_id,
            'received_by_user_id' => $user->id,
            'device_id' => $device?->id,
            /*
             * Normalised, like every other method that reaches this column.
             * The ternary this replaces did nothing at all — both arms were the
             * same value — and passed the client's spelling straight into a
             * check constraint. No shipping client refunds by a method that
             * fails it today, which is exactly the state the sale path was in
             * before a picker was renamed.
             */
            'method' => Payment::canonicalMethod($return->refund_method) ?? 'other',
            'amount' => -$amount,
            'notes' => "Refund for return {$return->id}",
            'client_created_at' => $return->client_created_at,
        ]);
    }

    public function delete(string $storeId, string $recordId, User $user, ?Device $device): UpsertOutcome
    {
        // A refund that happened cannot be un-happened by deleting the record.
        return UpsertOutcome::conflict('Returns cannot be deleted; process a correcting sale instead.');
    }
}

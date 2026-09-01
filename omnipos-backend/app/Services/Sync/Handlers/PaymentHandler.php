<?php

namespace App\Services\Sync\Handlers;

use App\Models\Customer;
use App\Models\Device;
use App\Models\Order;
use App\Models\Payment;
use App\Models\StoreMember;
use App\Models\User;
use App\Services\CustomerLedger;
use App\Services\Sync\EntityHandler;
use App\Services\Sync\UpsertOutcome;

/**
 * Money a customer hands over to settle their account.
 *
 * This exists because taking cash across the counter cannot depend on a
 * connection. A shop that lets a customer buy on credit will have them come back
 * on Saturday to pay some of it off, and refusing that because the line is down
 * means either turning the money away or writing it on paper — and paper is what
 * this system is replacing.
 *
 * Payments made as part of a sale do NOT come through here: OrderHandler writes
 * those alongside the order, in the same transaction, because a sale whose items
 * landed and whose tenders did not would corrupt the day's takings. This handler
 * is only for settlements against an existing balance.
 *
 * Refunds do not come through here either. They are negative payments written by
 * ReturnHandler, where the restock and the eligibility check belong with them.
 */
class PaymentHandler implements EntityHandler
{
    public function __construct(private readonly CustomerLedger $ledger)
    {
    }

    public function authorize(User $user, string $storeId, string $action, array $payload): bool
    {
        if ($action === 'delete') {
            return false;
        }

        // A cashier takes payment at the counter; that is the whole point.
        return $user->hasStoreRole($storeId, [
            StoreMember::ROLE_ADMIN,
            StoreMember::ROLE_MANAGER,
            StoreMember::ROLE_CASHIER,
        ]);
    }

    public function upsert(string $storeId, string $recordId, array $payload, User $user, ?Device $device): UpsertOutcome
    {
        $existing = Payment::find($recordId);

        if ($existing && $existing->store_id !== $storeId) {
            return UpsertOutcome::conflict('Record belongs to a different store.');
        }

        // Already recorded. A replay must not credit the customer twice — this
        // is the single most important line in the file, because the failure it
        // prevents looks like the customer paying and the debt halving again.
        if ($existing) {
            return UpsertOutcome::applied($existing->toArray());
        }

        $customerId = $payload['customer_id'] ?? null;
        if (! $customerId) {
            return UpsertOutcome::conflict('A settlement must name the customer it belongs to.');
        }

        $customer = Customer::forStore($storeId)->find($customerId);
        if (! $customer) {
            return UpsertOutcome::conflict('That customer is not on this server yet.', [
                'customer_id' => $customerId,
            ]);
        }

        $amount = (float) ($payload['amount'] ?? 0);
        if ($amount <= 0) {
            // Negative amounts are refunds, and a refund carries a restock and an
            // eligibility check that this path knows nothing about. Letting one
            // through here would move money without moving the goods.
            return UpsertOutcome::conflict('A settlement must be a positive amount; refunds go through returns.');
        }

        $method = $payload['method'] ?? 'cash';
        if (! in_array($method, Payment::METHODS, true)) {
            return UpsertOutcome::conflict(
                sprintf('Unknown payment method [%s].', $method),
                ['allowed' => Payment::METHODS],
            );
        }

        // Naming an order settles that invoice as well as the account. A wrong id
        // would silently mark someone else's sale paid, so it is checked rather
        // than passed through.
        $orderId = $payload['order_id'] ?? null;
        if ($orderId && ! Order::forStore($storeId)->whereKey($orderId)->exists()) {
            return UpsertOutcome::conflict('The sale this payment settles is not on this server.', [
                'order_id' => $orderId,
            ]);
        }

        $payment = $this->ledger->settle($customer, [
            'id' => $recordId,
            'order_id' => $orderId,
            'register_shift_id' => $payload['register_shift_id'] ?? null,
            'device_id' => $device?->id,
            'method' => $method,
            'amount' => $amount,
            'reference' => $payload['reference'] ?? null,
            'notes' => $payload['notes'] ?? null,
            'client_created_at' => $payload['client_created_at'] ?? null,
        ], $user);

        return UpsertOutcome::applied($payment->fresh()->toArray());
    }

    public function delete(string $storeId, string $recordId, User $user, ?Device $device): UpsertOutcome
    {
        // Money that changed hands cannot be un-received by deleting the row.
        // Correcting an over-payment is a refund, which leaves its own trace.
        return UpsertOutcome::conflict('Payments cannot be deleted; record a refund instead.');
    }
}

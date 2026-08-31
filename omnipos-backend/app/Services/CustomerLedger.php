<?php

namespace App\Services;

use App\Models\Customer;
use App\Models\Order;
use App\Models\Payment;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Customer money, in one place.
 *
 * total_spend and outstanding_balance are caches over orders and payments, in
 * the same way products.stock is a cache over stock_movements. Clients read them
 * and never write them: two tills settling the same debt while offline would
 * otherwise each push their own idea of the remaining balance, and the later
 * arrival would silently reinstate money the customer has already handed over.
 */
class CustomerLedger
{
    /**
     * Record a payment against a customer and refresh their balance.
     *
     * Where an order is named, the order's amount_paid moves too, so a credit
     * sale settles both the invoice and the account in one transaction.
     */
    public function settle(Customer $customer, array $data, User $user): Payment
    {
        return DB::transaction(function () use ($customer, $data, $user) {
            $payment = Payment::create([
                'store_id' => $customer->store_id,
                'order_id' => $data['order_id'] ?? null,
                'customer_id' => $customer->id,
                'register_shift_id' => $data['register_shift_id'] ?? null,
                'received_by_user_id' => $user->id,
                'method' => $data['method'],
                'amount' => $data['amount'],
                'reference' => $data['reference'] ?? null,
                'notes' => $data['notes'] ?? null,
                'client_created_at' => now(),
            ]);

            if (! empty($data['order_id'])) {
                $this->applyToOrder($data['order_id'], $customer->store_id, (string) $data['amount']);
            }

            $this->recompute($customer);

            return $payment;
        });
    }

    /**
     * Move an order's amount_paid, capped at its total.
     *
     * Overpayment stays on the customer account rather than inflating the
     * invoice, so the order still reconciles against its own receipt.
     */
    private function applyToOrder(string $orderId, string $storeId, string $amount): void
    {
        $order = Order::where('store_id', $storeId)->lockForUpdate()->find($orderId);

        if (! $order) {
            return;
        }

        $paid = bcadd((string) $order->amount_paid, $amount, 2);
        if (bccomp($paid, (string) $order->total, 2) === 1) {
            $paid = (string) $order->total;
        }

        $order->forceFill([
            'amount_paid' => $paid,
            'version' => $order->version + 1,
        ])->save();
    }

    /** Rebuild the cached totals from the evidence. */
    public function recompute(Customer $customer): void
    {
        $spend = (string) (Order::where('customer_id', $customer->id)
            ->where('status', 'completed')->sum('total') ?: 0);

        $paid = (string) (Payment::where('customer_id', $customer->id)->sum('amount') ?: 0);

        $outstanding = bcsub($spend, $paid, 2);
        if (bccomp($outstanding, '0', 2) === -1) {
            $outstanding = '0.00';
        }

        $customer->forceFill([
            'total_spend' => $spend,
            'outstanding_balance' => $outstanding,
        ])->save();
    }

    /** @return array<string, mixed> */
    public function summarise(Customer $customer): array
    {
        $orders = Order::where('customer_id', $customer->id);

        return [
            'orders_count' => (clone $orders)->count(),
            'total_invoiced' => (string) ((clone $orders)->where('status', 'completed')->sum('total') ?: 0),
            'total_paid' => (string) (Payment::where('customer_id', $customer->id)->sum('amount') ?: 0),
            'outstanding_balance' => $customer->outstanding_balance,
            'unpaid_orders' => (clone $orders)
                ->where('status', 'completed')
                ->whereColumn('amount_paid', '<', 'total')
                ->count(),
            'last_purchase_at' => (clone $orders)->max('client_created_at'),
        ];
    }
}

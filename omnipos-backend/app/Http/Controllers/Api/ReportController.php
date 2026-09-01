<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Api\Concerns\ScopesToStore;
use App\Http\Controllers\Controller;
use App\Models\Order;
use App\Models\Payment;
use App\Models\SaleReturn;
use App\Models\StoreMember;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Reporting.
 *
 * Every date filter runs on client_created_at — when the sale happened at the
 * till — not created_at, which for an offline sale is whenever the device next
 * reconnected. Reporting on created_at would move a day's takings into whichever
 * day the terminal came back online, which is the single most likely way for
 * these numbers to be quietly wrong.
 */
class ReportController extends Controller
{
    use ScopesToStore;

    /** GET /api/reports/dashboard — the figures the home screen needs, in one call. */
    public function dashboard(Request $request): JsonResponse
    {
        $storeId = $this->storeId($request);
        [$from, $to] = $this->range($request, 'today');

        $orders = Order::forStore($storeId)->completed()
            ->whereBetween('client_created_at', [$from, $to]);

        $gross = (string) ((clone $orders)->sum('total') ?: 0);
        $count = (clone $orders)->count();

        $refunds = (string) (SaleReturn::forStore($storeId)
            ->whereBetween('client_created_at', [$from, $to])->sum('amount') ?: 0);

        $lowStock = DB::table('products')->where('store_id', $storeId)
            ->whereNull('deleted_at')->where('is_active', true)
            ->whereColumn('stock', '<=', 'reorder_level')->count();

        $debt = (string) (DB::table('customers')->where('store_id', $storeId)
            ->whereNull('deleted_at')->sum('outstanding_balance') ?: 0);

        return response()->json([
            'range' => ['from' => $from->toIso8601String(), 'to' => $to->toIso8601String()],
            'sales' => [
                'gross' => $gross,
                'net' => bcsub($gross, $refunds, 2),
                'orders' => $count,
                'average_order' => $count > 0 ? bcdiv($gross, (string) $count, 2) : '0.00',
                'refunds' => $refunds,
            ],
            'profit' => $this->grossProfit($storeId, $from, $to),
            'low_stock_count' => $lowStock,
            'outstanding_debt' => $debt,
            'top_products' => $this->topProducts($storeId, $from, $to, 5),
            'payments_by_method' => $this->paymentsByMethod($storeId, $from, $to),
        ]);
    }

    /** GET /api/reports/sales — query: from, to, group_by=day|week|month */
    public function sales(Request $request): JsonResponse
    {
        $storeId = $this->storeId($request);
        [$from, $to] = $this->range($request, 'month');

        $groupBy = in_array($request->query('group_by'), ['day', 'week', 'month'], true)
            ? $request->query('group_by') : 'day';

        $rows = DB::table('orders')
            ->where('store_id', $storeId)
            ->where('status', 'completed')
            ->whereBetween('client_created_at', [$from, $to])
            ->selectRaw("date_trunc(?, client_created_at) as bucket,
                         count(*) as orders,
                         coalesce(sum(total), 0) as gross,
                         coalesce(sum(tax), 0) as tax,
                         coalesce(sum(discount), 0) as discount", [$groupBy])
            ->groupBy('bucket')->orderBy('bucket')
            ->get();

        return response()->json([
            'range' => ['from' => $from->toIso8601String(), 'to' => $to->toIso8601String()],
            'group_by' => $groupBy,
            'series' => $rows->map(fn ($r) => [
                'period' => Carbon::parse($r->bucket)->toDateString(),
                'orders' => (int) $r->orders,
                'gross' => (string) $r->gross,
                'tax' => (string) $r->tax,
                'discount' => (string) $r->discount,
            ]),
            'totals' => [
                'orders' => (int) $rows->sum('orders'),
                'gross' => (string) $rows->sum(fn ($r) => (float) $r->gross),
            ],
        ]);
    }

    /**
     * GET /api/reports/profit
     *
     * Cost prices are commercially sensitive, so this is admin/manager only —
     * the same boundary that hides cost_price from a cashier on a product.
     */
    public function profit(Request $request): JsonResponse
    {
        $storeId = $this->storeId($request);
        $this->assertMaySeeCost($request, $storeId);

        [$from, $to] = $this->range($request, 'month');

        return response()->json([
            'range' => ['from' => $from->toIso8601String(), 'to' => $to->toIso8601String()],
            ...$this->grossProfit($storeId, $from, $to),
            'by_product' => $this->topProducts($storeId, $from, $to, 50, withCost: true),
        ]);
    }

    /** GET /api/reports/cashiers — takings and drawer variance per cashier. */
    public function cashiers(Request $request): JsonResponse
    {
        $storeId = $this->storeId($request);
        [$from, $to] = $this->range($request, 'month');

        $sales = DB::table('orders')
            ->join('users', 'users.id', '=', 'orders.cashier_user_id')
            ->where('orders.store_id', $storeId)
            ->where('orders.status', 'completed')
            ->whereBetween('orders.client_created_at', [$from, $to])
            ->groupBy('users.id', 'users.name')
            ->selectRaw('users.id, users.name, count(*) as orders, coalesce(sum(orders.total), 0) as gross')
            ->get();

        $variance = DB::table('register_shifts')
            ->where('store_id', $storeId)
            ->where('status', 'closed')
            ->whereBetween('opened_at', [$from, $to])
            ->groupBy('cashier_user_id')
            ->selectRaw('cashier_user_id, count(*) as shifts, coalesce(sum(discrepancy), 0) as variance')
            ->get()->keyBy('cashier_user_id');

        return response()->json([
            'range' => ['from' => $from->toIso8601String(), 'to' => $to->toIso8601String()],
            'cashiers' => $sales->map(fn ($r) => [
                'user_id' => $r->id,
                'name' => $r->name,
                'orders' => (int) $r->orders,
                'gross' => (string) $r->gross,
                'shifts' => (int) ($variance[$r->id]->shifts ?? 0),
                'cash_variance' => (string) ($variance[$r->id]->variance ?? '0.00'),
            ]),
        ]);
    }

    /** GET /api/reports/customers — spend and debt. */
    public function customers(Request $request): JsonResponse
    {
        $storeId = $this->storeId($request);

        $top = DB::table('customers')->where('store_id', $storeId)->whereNull('deleted_at')
            ->orderByDesc('total_spend')->limit(20)
            ->get(['id', 'name', 'phone', 'total_spend', 'outstanding_balance']);

        $debtors = DB::table('customers')->where('store_id', $storeId)->whereNull('deleted_at')
            ->where('outstanding_balance', '>', 0)
            ->orderByDesc('outstanding_balance')->limit(50)
            ->get(['id', 'name', 'phone', 'outstanding_balance']);

        return response()->json([
            'top_customers' => $top,
            'debtors' => $debtors,
            'total_outstanding' => (string) ($debtors->sum('outstanding_balance') ?: 0),
        ]);
    }

    /** GET /api/reports/inventory */
    public function inventory(Request $request): JsonResponse
    {
        $storeId = $this->storeId($request);

        // Every column here is qualified because products and product_batches
        // BOTH carry expiry_date, and Postgres rejects the unqualified name
        // outright. Unqualified, this endpoint threw on every call — which is
        // why it went unnoticed until a screen finally asked for it.
        $expiring = DB::table('product_batches')
            ->join('products', 'products.id', '=', 'product_batches.product_id')
            ->where('product_batches.store_id', $storeId)
            ->whereNull('product_batches.deleted_at')
            ->whereNotNull('product_batches.expiry_date')
            ->whereDate('product_batches.expiry_date', '<=', now()->addDays(30))
            ->orderBy('product_batches.expiry_date')
            ->limit(100)
            ->get([
                'product_batches.id',
                'products.name',
                'product_batches.batch_number',
                'product_batches.quantity',
                'product_batches.expiry_date',
            ]);

        return response()->json([
            'low_stock' => DB::table('products')->where('store_id', $storeId)
                ->whereNull('deleted_at')->where('is_active', true)
                ->whereColumn('stock', '<=', 'reorder_level')
                ->orderBy('stock')->limit(100)
                ->get(['id', 'name', 'sku', 'stock', 'reorder_level']),
            'oversold' => DB::table('products')->where('store_id', $storeId)
                ->whereNull('deleted_at')->where('stock', '<', 0)
                ->get(['id', 'name', 'sku', 'stock']),
            'expiring_batches' => $expiring,
        ]);
    }

    // ---------------------------------------------------------------- helpers

    /**
     * Gross profit from the cost captured on each line at time of sale.
     *
     * Lines with no unit_cost are excluded and counted separately rather than
     * being valued at today's cost price. Everything imported from Supabase falls
     * into that bucket: the historical cost was never recorded, and substituting
     * the current one would produce a margin that looks precise and is fiction.
     */
    private function grossProfit(string $storeId, Carbon $from, Carbon $to): array
    {
        $row = DB::table('order_items')
            ->join('orders', 'orders.id', '=', 'order_items.order_id')
            ->where('order_items.store_id', $storeId)
            ->where('orders.status', 'completed')
            ->whereBetween('orders.client_created_at', [$from, $to])
            ->selectRaw('
                coalesce(sum(case when unit_cost is not null then line_total else 0 end), 0) as revenue_with_cost,
                coalesce(sum(case when unit_cost is not null then unit_cost * quantity else 0 end), 0) as cogs,
                count(*) filter (where unit_cost is null) as lines_without_cost,
                count(*) as lines_total
            ')->first();

        $revenue = (string) $row->revenue_with_cost;
        $cogs = (string) $row->cogs;
        $profit = bcsub($revenue, $cogs, 2);

        return [
            'revenue_with_known_cost' => $revenue,
            'cogs' => $cogs,
            'gross_profit' => $profit,
            'margin_percent' => bccomp($revenue, '0', 2) === 1
                ? bcdiv(bcmul($profit, '100', 2), $revenue, 2)
                : null,
            'lines_without_cost' => (int) $row->lines_without_cost,
            'lines_total' => (int) $row->lines_total,
            'coverage_note' => (int) $row->lines_without_cost > 0
                ? 'Lines with no recorded unit cost are excluded; profit covers only the lines that have one.'
                : null,
        ];
    }

    private function topProducts(string $storeId, Carbon $from, Carbon $to, int $limit, bool $withCost = false): array
    {
        $select = '
            order_items.product_id,
            max(order_items.product_name) as name,
            sum(order_items.quantity) as units,
            coalesce(sum(order_items.line_total), 0) as revenue
        ';

        if ($withCost) {
            $select .= ', coalesce(sum(case when unit_cost is not null then unit_cost * quantity else 0 end), 0) as cogs';
        }

        return DB::table('order_items')
            ->join('orders', 'orders.id', '=', 'order_items.order_id')
            ->where('order_items.store_id', $storeId)
            ->where('orders.status', 'completed')
            ->whereBetween('orders.client_created_at', [$from, $to])
            ->groupBy('order_items.product_id')
            ->selectRaw($select)
            ->orderByDesc('revenue')
            ->limit($limit)
            ->get()
            ->map(function ($r) use ($withCost) {
                $row = [
                    'product_id' => $r->product_id,
                    'name' => $r->name,
                    'units' => (int) $r->units,
                    'revenue' => (string) $r->revenue,
                ];
                if ($withCost) {
                    $row['cogs'] = (string) $r->cogs;
                    $row['gross_profit'] = bcsub((string) $r->revenue, (string) $r->cogs, 2);
                }

                return $row;
            })->all();
    }

    /**
     * Takings split by tender.
     *
     * Windowed on client_created_at — when the money actually changed hands —
     * not created_at, which is when the server heard about it. Every other
     * figure in these reports uses the client time, so filtering payments by
     * server time made them disagree: a sale rung up offline on Monday and
     * synced on Tuesday put its total in Monday's gross and its tender in
     * Tuesday's breakdown, and the two stopped adding up for exactly the shops
     * that most need them to.
     *
     * Coalesced because an imported row may predate the column.
     */
    private function paymentsByMethod(string $storeId, Carbon $from, Carbon $to): array
    {
        return Payment::where('store_id', $storeId)
            ->whereRaw('coalesce(client_created_at, created_at) between ? and ?', [$from, $to])
            ->groupBy('method')
            ->selectRaw('method, coalesce(sum(amount), 0) as total, count(*) as count')
            ->get()
            ->mapWithKeys(fn ($r) => [$r->method => ['total' => (string) $r->total, 'count' => (int) $r->count]])
            ->all();
    }

    /** @return array{0: Carbon, 1: Carbon} */
    private function range(Request $request, string $default): array
    {
        $from = $request->query('from');
        $to = $request->query('to');

        if ($from && $to) {
            return [Carbon::parse($from)->startOfDay(), Carbon::parse($to)->endOfDay()];
        }

        return match ($default) {
            'today' => [now()->startOfDay(), now()->endOfDay()],
            'week' => [now()->startOfWeek(), now()->endOfDay()],
            default => [now()->startOfMonth(), now()->endOfDay()],
        };
    }

    private function assertMaySeeCost(Request $request, string $storeId): void
    {
        abort_unless(
            $request->user()->hasStoreRole($storeId, [StoreMember::ROLE_ADMIN, StoreMember::ROLE_MANAGER]),
            403,
            'Only an admin or manager can view cost and profit figures.'
        );
    }
}

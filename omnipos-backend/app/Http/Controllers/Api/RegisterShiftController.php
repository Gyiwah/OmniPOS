<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Api\Concerns\ScopesToStore;
use App\Http\Controllers\Controller;
use App\Http\Resources\RegisterShiftResource;
use App\Models\AuditLog;
use App\Models\RegisterShift;
use App\Models\StoreMember;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * The cash drawer.
 *
 * expected_cash is always recomputed from the payments ledger, never taken from
 * the client. A terminal that syncs late would otherwise understate the till and
 * make a correct drawer look short — which in a shop means accusing a cashier of
 * theft on the strength of a synchronisation lag.
 */
class RegisterShiftController extends Controller
{
    use ScopesToStore;

    /** GET /api/register-shifts — query: status, cashier_user_id, from, to */
    public function index(Request $request): AnonymousResourceCollection
    {
        $query = RegisterShift::forStore($this->storeId($request))->with('cashier:id,name');

        if ($status = $request->query('status')) {
            $query->where('status', $status);
        }
        if ($cashier = $request->query('cashier_user_id')) {
            $query->where('cashier_user_id', $cashier);
        }
        if ($from = $request->query('from')) {
            $query->where('opened_at', '>=', $from);
        }
        if ($to = $request->query('to')) {
            $query->where('opened_at', '<=', $to);
        }

        return RegisterShiftResource::collection(
            $query->latest('opened_at')->paginate($this->perPage($request))
        );
    }

    /** GET /api/register-shifts/current — the caller's own open shift, if any. */
    public function current(Request $request): JsonResponse
    {
        $shift = RegisterShift::forStore($this->storeId($request))
            ->where('cashier_user_id', $request->user()->id)
            ->open()
            ->latest('opened_at')
            ->first();

        if (! $shift) {
            return response()->json(['shift' => null]);
        }

        return response()->json([
            'shift' => new RegisterShiftResource($this->withLiveTotals($shift)),
        ]);
    }

    public function show(Request $request, string $shift): RegisterShiftResource
    {
        return new RegisterShiftResource($this->withLiveTotals($this->find($request, $shift)));
    }

    /**
     * POST /api/register-shifts
     *
     * A partial unique index permits one open shift per cashier per store. The
     * check here exists so the client gets an explanation rather than a raw
     * constraint violation.
     */
    public function open(Request $request): JsonResponse
    {
        $storeId = $this->storeId($request);
        $this->assertTillRole($request);

        $data = $request->validate([
            'id' => ['sometimes', 'uuid', Rule::unique('register_shifts', 'id')],
            'opening_float' => ['required', 'numeric', 'min:0'],
            'device_id' => ['nullable', 'uuid'],
            'notes' => ['nullable', 'string'],
        ]);

        $existing = RegisterShift::forStore($storeId)
            ->where('cashier_user_id', $request->user()->id)
            ->open()->first();

        if ($existing) {
            return response()->json([
                'message' => 'You already have an open shift. Close it before opening another.',
                'shift' => new RegisterShiftResource($existing),
            ], 409);
        }

        $shift = RegisterShift::create([
            'id' => $data['id'] ?? null,
            'store_id' => $storeId,
            'cashier_user_id' => $request->user()->id,
            'device_id' => $data['device_id'] ?? null,
            'opened_at' => now(),
            'opening_float' => $data['opening_float'],
            'expected_cash' => $data['opening_float'],
            'status' => 'open',
            'notes' => $data['notes'] ?? null,
            'movements_json' => [],
        ]);

        return (new RegisterShiftResource($shift))->response()->setStatusCode(201);
    }

    /**
     * POST /api/register-shifts/{shift}/cash-movement
     *
     * Paid-ins and paid-outs during a shift — a float top-up, a supplier paid
     * from the drawer. Appended to the shift's movement list and folded into the
     * expected cash.
     */
    public function cashMovement(Request $request, string $shift): JsonResponse
    {
        $model = $this->find($request, $shift);
        $this->assertOwnerOrManager($request, $model);

        if ($model->status !== 'open') {
            return response()->json(['message' => 'This shift is closed.'], 422);
        }

        $data = $request->validate([
            'direction' => ['required', Rule::in(['in', 'out'])],
            'amount' => ['required', 'numeric', 'gt:0'],
            'reason' => ['required', 'string', 'max:255'],
        ]);

        DB::transaction(function () use ($model, $data, $request) {
            $movements = $model->movements_json ?? [];
            $movements[] = [
                'direction' => $data['direction'],
                'amount' => $data['amount'],
                'reason' => $data['reason'],
                'by' => $request->user()->id,
                'at' => now()->toIso8601String(),
            ];

            $field = $data['direction'] === 'in' ? 'cash_in' : 'cash_out';

            $model->forceFill([
                'movements_json' => $movements,
                $field => bcadd((string) $model->{$field}, (string) $data['amount'], 2),
            ])->save();

            $model->forceFill(['expected_cash' => $model->computeExpectedCash()])->save();
        });

        return response()->json(['shift' => new RegisterShiftResource($model->refresh())]);
    }

    /**
     * POST /api/register-shifts/{shift}/close
     *
     * The cashier counts the drawer and states actual_cash. The discrepancy is
     * computed here against the ledger-derived expectation — the client does not
     * get to supply it.
     */
    public function close(Request $request, string $shift): JsonResponse
    {
        $model = $this->find($request, $shift);
        $this->assertOwnerOrManager($request, $model);

        if ($model->status === 'closed') {
            return response()->json(['message' => 'This shift is already closed.'], 422);
        }

        $data = $request->validate([
            'actual_cash' => ['required', 'numeric', 'min:0'],
            'notes' => ['nullable', 'string'],
        ]);

        DB::transaction(function () use ($model, $data, $request) {
            $expected = $model->computeExpectedCash();
            $discrepancy = bcsub((string) $data['actual_cash'], $expected, 2);

            $model->forceFill([
                'closed_at' => now(),
                'status' => 'closed',
                'cash_sales' => (string) $model->payments()->cash()->sum('amount'),
                'expected_cash' => $expected,
                'actual_cash' => $data['actual_cash'],
                'discrepancy' => $discrepancy,
                'notes' => $data['notes'] ?? $model->notes,
            ])->save();

            // A drawer that does not balance is exactly the sort of event a shop
            // needs to be able to look back at months later.
            if (bccomp($discrepancy, '0', 2) !== 0) {
                AuditLog::create([
                    'store_id' => $model->store_id,
                    'user_id' => $request->user()->id,
                    'action' => 'shift.closed_with_discrepancy',
                    'entity_type' => 'register_shift',
                    'entity_id' => $model->id,
                    'after' => [
                        'expected_cash' => $expected,
                        'actual_cash' => $data['actual_cash'],
                        'discrepancy' => $discrepancy,
                    ],
                    'ip_address' => $request->ip(),
                    'user_agent' => $request->userAgent(),
                ]);
            }
        });

        return response()->json(['shift' => new RegisterShiftResource($model->refresh())]);
    }

    /**
     * GET /api/register-shifts/{shift}/z-report
     *
     * End-of-shift summary: takings by tender, sales and refund counts, and the
     * cash reconciliation.
     */
    public function zReport(Request $request, string $shift): JsonResponse
    {
        $model = $this->find($request, $shift);

        $byMethod = $model->payments()
            ->selectRaw('method, sum(amount) as total, count(*) as count')
            ->groupBy('method')->get()
            ->mapWithKeys(fn ($r) => [$r->method => ['total' => (string) $r->total, 'count' => (int) $r->count]]);

        $orders = $model->orders()->where('status', 'completed');
        $refunds = \App\Models\SaleReturn::where('register_shift_id', $model->id);

        return response()->json([
            'shift' => new RegisterShiftResource($model),
            'sales' => [
                'count' => (clone $orders)->count(),
                'gross' => (string) ((clone $orders)->sum('total') ?: 0),
                'tax' => (string) ((clone $orders)->sum('tax') ?: 0),
                'discount' => (string) ((clone $orders)->sum('discount') ?: 0),
            ],
            'refunds' => [
                'count' => (clone $refunds)->count(),
                'total' => (string) ((clone $refunds)->sum('amount') ?: 0),
            ],
            'payments_by_method' => $byMethod,
            'cash_reconciliation' => [
                'opening_float' => $model->opening_float,
                'cash_taken' => (string) ($model->payments()->cash()->sum('amount') ?: 0),
                'cash_in' => $model->cash_in,
                'cash_out' => $model->cash_out,
                'expected_cash' => $model->computeExpectedCash(),
                'actual_cash' => $model->actual_cash,
                'discrepancy' => $model->discrepancy,
            ],
        ]);
    }

    /** Open shifts report live figures rather than whatever was last persisted. */
    private function withLiveTotals(RegisterShift $shift): RegisterShift
    {
        if ($shift->status === 'open') {
            $shift->setAttribute('expected_cash', $shift->computeExpectedCash());
            $shift->setAttribute('cash_sales', (string) ($shift->payments()->cash()->sum('amount') ?: 0));
        }

        return $shift;
    }

    private function assertTillRole(Request $request): void
    {
        $allowed = $request->user()->hasStoreRole($this->storeId($request), [
            StoreMember::ROLE_ADMIN, StoreMember::ROLE_MANAGER, StoreMember::ROLE_CASHIER,
        ]);

        abort_unless($allowed, 403, 'Your role does not permit operating a register.');
    }

    /** A cashier may only touch their own drawer; managers may touch any. */
    private function assertOwnerOrManager(Request $request, RegisterShift $shift): void
    {
        $user = $request->user();

        if ($shift->cashier_user_id === $user->id) {
            return;
        }

        $allowed = $user->hasStoreRole($shift->store_id, [StoreMember::ROLE_ADMIN, StoreMember::ROLE_MANAGER]);

        abort_unless($allowed, 403, 'This shift belongs to another cashier.');
    }

    private function find(Request $request, string $id): RegisterShift
    {
        return RegisterShift::forStore($this->storeId($request))->findOrFail($id);
    }
}

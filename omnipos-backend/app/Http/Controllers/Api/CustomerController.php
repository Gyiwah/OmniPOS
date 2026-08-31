<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Api\Concerns\ScopesToStore;
use App\Http\Controllers\Controller;
use App\Http\Resources\CustomerResource;
use App\Http\Resources\OrderResource;
use App\Http\Resources\PaymentResource;
use App\Models\Customer;
use App\Models\StoreMember;
use App\Services\CustomerLedger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Validation\Rule;

class CustomerController extends Controller
{
    use ScopesToStore;

    public function __construct(private readonly CustomerLedger $ledger)
    {
    }

    /** GET /api/customers — query: search, has_debt, sort */
    public function index(Request $request): AnonymousResourceCollection
    {
        $query = Customer::forStore($this->storeId($request))->withCount('orders');

        if ($search = trim((string) $request->query('search', ''))) {
            $query->where(function ($q) use ($search) {
                $q->where('name', 'ilike', "%{$search}%")
                    ->orWhere('phone', 'ilike', "%{$search}%")
                    ->orWhere('email', 'ilike', "%{$search}%");
            });
        }

        if ($request->boolean('has_debt')) {
            $query->where('outstanding_balance', '>', 0);
        }

        $sort = $request->query('sort', 'name');
        $query->orderBy(in_array($sort, ['name', 'total_spend', 'outstanding_balance', 'created_at'], true) ? $sort : 'name');

        return CustomerResource::collection($query->paginate($this->perPage($request)));
    }

    public function show(Request $request, string $customer): CustomerResource
    {
        return new CustomerResource($this->find($request, $customer)->loadCount('orders'));
    }

    public function store(Request $request): JsonResponse
    {
        $this->assertCanWrite($request);

        $data = $request->validate([
            'id' => ['sometimes', 'uuid', Rule::unique('customers', 'id')],
            'name' => ['required', 'string', 'max:255'],
            'phone' => ['nullable', 'string', 'max:40'],
            'email' => ['nullable', 'email', 'max:255'],
            'notes' => ['nullable', 'string'],
        ]);

        // Balances are never accepted from a client; they are derived.
        $customer = Customer::create([
            ...$data,
            'store_id' => $this->storeId($request),
            'total_spend' => 0,
            'outstanding_balance' => 0,
        ]);

        return (new CustomerResource($customer))->response()->setStatusCode(201);
    }

    public function update(Request $request, string $customer): CustomerResource
    {
        $this->assertCanWrite($request);
        $model = $this->find($request, $customer);

        $model->update($request->validate([
            'name' => ['sometimes', 'string', 'max:255'],
            'phone' => ['nullable', 'string', 'max:40'],
            'email' => ['nullable', 'email', 'max:255'],
            'notes' => ['nullable', 'string'],
        ]));

        return new CustomerResource($model->refresh());
    }

    /**
     * DELETE /api/customers/{customer}
     *
     * Refused while money is owed: deleting the record would erase the evidence
     * of a debt without collecting it.
     */
    public function destroy(Request $request, string $customer): JsonResponse
    {
        $model = $this->find($request, $customer);

        if (! $request->user()->hasStoreRole($model->store_id, [StoreMember::ROLE_ADMIN, StoreMember::ROLE_MANAGER])) {
            abort(403, 'Only an admin or manager can delete a customer.');
        }

        if (bccomp((string) $model->outstanding_balance, '0', 2) === 1) {
            return response()->json([
                'message' => 'This customer has an outstanding balance and cannot be deleted.',
                'outstanding_balance' => $model->outstanding_balance,
            ], 422);
        }

        $model->delete();

        return response()->json(['deleted' => true]);
    }

    /** GET /api/customers/{customer}/orders — purchase history. */
    public function orders(Request $request, string $customer): AnonymousResourceCollection
    {
        $model = $this->find($request, $customer);

        return OrderResource::collection(
            $model->orders()->with('items')->latest('client_created_at')->paginate($this->perPage($request))
        );
    }

    /** GET /api/customers/{customer}/statement — history plus running balance. */
    public function statement(Request $request, string $customer): JsonResponse
    {
        $model = $this->find($request, $customer);

        return response()->json([
            'customer' => new CustomerResource($model),
            'orders' => OrderResource::collection($model->orders()->latest('client_created_at')->get()),
            'payments' => PaymentResource::collection($model->payments()->latest('created_at')->get()),
            'summary' => $this->ledger->summarise($model),
        ]);
    }

    /**
     * POST /api/customers/{customer}/payments
     *
     * Settle some or all of a debt. The payment is recorded in the ledger and
     * the balance is recomputed from it — the client never states the new
     * balance, so two tills settling the same debt cannot disagree about the
     * result.
     */
    public function recordPayment(Request $request, string $customer): JsonResponse
    {
        $model = $this->find($request, $customer);
        $this->assertCanWrite($request);

        $data = $request->validate([
            'amount' => ['required', 'numeric', 'gt:0'],
            'method' => ['required', Rule::in(\App\Models\Payment::METHODS)],
            'reference' => ['nullable', 'string', 'max:255'],
            'notes' => ['nullable', 'string'],
            'order_id' => ['nullable', 'uuid'],
            'register_shift_id' => ['nullable', 'uuid'],
        ]);

        $payment = $this->ledger->settle($model, $data, $request->user());

        return response()->json([
            'payment' => new PaymentResource($payment),
            'customer' => new CustomerResource($model->refresh()),
        ], 201);
    }

    /** Cashiers register and update customers at the till, as in the mobile app. */
    private function assertCanWrite(Request $request): void
    {
        $allowed = $request->user()->hasStoreRole($this->storeId($request), [
            StoreMember::ROLE_ADMIN, StoreMember::ROLE_MANAGER, StoreMember::ROLE_CASHIER,
        ]);

        abort_unless($allowed, 403, 'Your role does not permit this action.');
    }

    private function find(Request $request, string $id): Customer
    {
        return Customer::forStore($this->storeId($request))->findOrFail($id);
    }
}

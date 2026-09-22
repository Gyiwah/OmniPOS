<?php

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\CategoryController;
use App\Http\Controllers\Api\CustomerController;
use App\Http\Controllers\Api\InventoryController;
use App\Http\Controllers\Api\MediaController;
use App\Http\Controllers\Api\OrderController;
use App\Http\Controllers\Api\ProductController;
use App\Http\Controllers\Api\RegisterShiftController;
use App\Http\Controllers\Api\ReportController;
use App\Http\Controllers\Api\ReturnController;
use App\Http\Controllers\Api\StoreController;
use App\Http\Controllers\Api\StoreMemberController;
use App\Http\Controllers\Api\SuperAdminController;
use App\Http\Controllers\Api\SyncConflictController;
use App\Http\Controllers\Api\SyncController;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| OmniPOS API
|--------------------------------------------------------------------------
|
| Two client types share these routes:
|   - the web SPA, authenticated by Sanctum cookie session
|   - the mobile app, authenticated by Sanctum bearer token
|
| EVERY store-scoped route carries `store.access`. That middleware is the
| replacement for Supabase RLS: it resolves the store, verifies membership, and
| republishes the store id as a request attribute for controllers to scope from.
|
| Adding a store-scoped route WITHOUT it exposes every tenant's data. There is no
| database-level backstop any more. StoreAccessTest asserts this route file has
| no unguarded store-scoped routes, so an omission fails the build rather than
| reaching production.
|
| Role arguments narrow access further: store.access:admin,manager
|
*/

Route::prefix('auth')->group(function () {
    Route::post('login', [AuthController::class, 'login'])->middleware('throttle:6,1');
    Route::post('token', [AuthController::class, 'token'])->middleware('throttle:6,1');

    Route::middleware('auth:sanctum')->group(function () {
        Route::get('me', [AuthController::class, 'me']);
        Route::post('logout', [AuthController::class, 'logout']);
    });
});

Route::middleware('auth:sanctum')->group(function () {

    /*
    | Store discovery. Deliberately NOT behind store.access: this is how a client
    | finds out which stores it may then ask about. Scoped to the caller's own
    | memberships inside the controller.
    */
    Route::get('stores', [StoreController::class, 'index']);
    Route::post('stores', [StoreController::class, 'store']);

    /*
    | Synchronisation. Push is rate-limited generously rather than tightly: a
    | terminal returning from a long offline stretch legitimately sends many
    | batches in quick succession, and throttling that would strand real sales.
    */
    Route::prefix('sync')->middleware('store.access')->group(function () {
        Route::post('devices', [SyncController::class, 'registerDevice']);
        Route::post('push', [SyncController::class, 'push'])->middleware('throttle:120,1');
        Route::get('pull', [SyncController::class, 'pull'])->middleware('throttle:120,1');
    });

    /*
    | Conflicts are money that has already changed hands but could not be booked
    | as sent. Deciding what happens to one is a manager's call, not a cashier's,
    | so the role gate is on the route.
    */
    Route::prefix('sync')->middleware('store.access:admin,manager')->group(function () {
        Route::get('conflicts', [SyncConflictController::class, 'index']);
        Route::post('conflicts/{operationId}/resolve', [SyncConflictController::class, 'resolve']);
    });

    Route::middleware('store.access')->group(function () {

        // Store settings
        Route::get('store', [StoreController::class, 'show']);
        Route::patch('store', [StoreController::class, 'update']);

        // Catalogue
        Route::get('products', [ProductController::class, 'index']);
        Route::get('products/{product}', [ProductController::class, 'show']);
        Route::get('products/{product}/movements', [ProductController::class, 'movements']);
        Route::get('products/{product}/price-history', [ProductController::class, 'priceHistory']);
        Route::post('products', [ProductController::class, 'store']);
        Route::patch('products/{product}', [ProductController::class, 'update']);
        Route::delete('products/{product}', [ProductController::class, 'destroy']);

        Route::get('categories', [CategoryController::class, 'index']);
        Route::post('categories', [CategoryController::class, 'store']);
        Route::patch('categories/{category}', [CategoryController::class, 'update']);
        Route::delete('categories/{category}', [CategoryController::class, 'destroy']);

        // Inventory. All quantity changes go through the ledger.
        Route::get('stock-movements', [InventoryController::class, 'movements']);
        Route::post('stock-movements', [InventoryController::class, 'recordMovement']);
        Route::post('inventory/stock-take', [InventoryController::class, 'stockTake']);
        Route::get('inventory/low-stock', [InventoryController::class, 'lowStock']);
        Route::get('inventory/oversold', [InventoryController::class, 'oversold']);
        Route::get('inventory/batches', [InventoryController::class, 'batches']);
        Route::get('inventory/valuation', [InventoryController::class, 'valuation']);

        // Customers
        Route::get('customers', [CustomerController::class, 'index']);
        Route::get('customers/{customer}', [CustomerController::class, 'show']);
        Route::get('customers/{customer}/orders', [CustomerController::class, 'orders']);
        Route::get('customers/{customer}/statement', [CustomerController::class, 'statement']);
        Route::post('customers/{customer}/payments', [CustomerController::class, 'recordPayment']);
        Route::post('customers', [CustomerController::class, 'store']);
        Route::patch('customers/{customer}', [CustomerController::class, 'update']);
        Route::delete('customers/{customer}', [CustomerController::class, 'destroy']);

        /*
        | Orders and returns are read and acted on here, but NOT created here.
        | Sales are created by the client and arrive through /api/sync/push,
        | which is idempotent. A REST create would be a second implementation of
        | the money path, and divergence between the two shows up as missing
        | revenue. Voids are the exception: deliberate manager corrections.
        */
        Route::get('orders', [OrderController::class, 'index']);
        // Declared before the {order} route so "next-number" is not read as an id.
        Route::get('orders/next-number', [OrderController::class, 'nextNumber']);
        Route::get('orders/{order}', [OrderController::class, 'show']);
        Route::get('orders/{order}/receipt', [OrderController::class, 'receipt']);
        Route::post('orders/{order}/void', [OrderController::class, 'void']);

        Route::get('returns', [ReturnController::class, 'index']);
        Route::get('returns/eligibility/{order}', [ReturnController::class, 'eligibility']);
        Route::get('returns/{return}', [ReturnController::class, 'show']);

        // Register
        Route::get('register-shifts', [RegisterShiftController::class, 'index']);
        Route::get('register-shifts/current', [RegisterShiftController::class, 'current']);
        Route::get('register-shifts/{shift}', [RegisterShiftController::class, 'show']);
        Route::get('register-shifts/{shift}/z-report', [RegisterShiftController::class, 'zReport']);
        Route::post('register-shifts', [RegisterShiftController::class, 'open']);
        Route::post('register-shifts/{shift}/cash-movement', [RegisterShiftController::class, 'cashMovement']);
        Route::post('register-shifts/{shift}/close', [RegisterShiftController::class, 'close']);

        /*
        | Images. Reads are authorised by the store id that prefixes the path,
        | which is what replaces the RLS policy that guarded the Supabase bucket.
        */
        Route::post('media', [MediaController::class, 'store']);
        Route::post('media/store-logo', [MediaController::class, 'storeLogo']);
        Route::get('media/{path}', [MediaController::class, 'show'])->where('path', '.*');
        Route::delete('media/{path}', [MediaController::class, 'destroy'])->where('path', '.*');

        // Reports
        Route::get('reports/dashboard', [ReportController::class, 'dashboard']);
        Route::get('reports/sales', [ReportController::class, 'sales']);
        Route::get('reports/profit', [ReportController::class, 'profit']);
        Route::get('reports/inventory', [ReportController::class, 'inventory']);
        Route::get('reports/customers', [ReportController::class, 'customers']);
        Route::get('reports/cashiers', [ReportController::class, 'cashiers']);
    });

    /*
    | Platform operations. Deliberately NOT store-scoped: a super admin works
    | across tenants, so store.access cannot apply and the privilege is checked
    | explicitly in the controller instead.
    */
    Route::prefix('admin')->group(function () {
        Route::get('dashboard', [SuperAdminController::class, 'dashboard']);
        Route::get('stores', [SuperAdminController::class, 'stores']);
        Route::post('stores', [SuperAdminController::class, 'provision']);
        Route::patch('stores/{store}', [SuperAdminController::class, 'updateStore']);
        Route::delete('stores/{store}', [SuperAdminController::class, 'deleteStore']);
        Route::get('branches', [SuperAdminController::class, 'branches']);
        Route::post('branches', [SuperAdminController::class, 'createBranch']);
        Route::patch('branches/{branch}', [SuperAdminController::class, 'updateBranch']);
        Route::delete('branches/{branch}', [SuperAdminController::class, 'deleteBranch']);
        Route::get('stores/{store}/members', [SuperAdminController::class, 'members']);
        Route::patch('stores/{store}/status', [SuperAdminController::class, 'updateStoreStatus']);
        Route::get('users', [SuperAdminController::class, 'users']);
        Route::get('people', [SuperAdminController::class, 'people']);
        Route::post('people', [SuperAdminController::class, 'createPerson']);
        Route::patch('people/{user}/stores/{store}', [SuperAdminController::class, 'updateStoreMembershipRole']);
        Route::patch('people/{user}/platform-admin', [SuperAdminController::class, 'updatePlatformAdmin']);
        Route::patch('people/{user}', [SuperAdminController::class, 'updatePerson']);
        Route::delete('people/{user}', [SuperAdminController::class, 'deletePerson']);
        Route::get('devices', [SuperAdminController::class, 'devices']);
        Route::get('audit-logs', [SuperAdminController::class, 'auditLogs']);
        Route::get('sync-monitor', [SuperAdminController::class, 'syncMonitor']);
        Route::get('plans', [SuperAdminController::class, 'plans']);
        Route::post('plans', [SuperAdminController::class, 'createPlan']);
        Route::patch('plans/{plan}', [SuperAdminController::class, 'updatePlan']);
        Route::delete('plans/{plan}', [SuperAdminController::class, 'deletePlan']);
        Route::get('subscriptions', [SuperAdminController::class, 'subscriptions']);
        Route::post('stores/{store}/subscription', [SuperAdminController::class, 'assignSubscription']);
        Route::get('system-resources', [SuperAdminController::class, 'systemResources']);
        Route::post('system-resources/categories', [SuperAdminController::class, 'createGlobalCategory']);
        Route::patch('system-resources/categories/{category}', [SuperAdminController::class, 'updateGlobalCategory']);
        Route::delete('system-resources/categories/{category}', [SuperAdminController::class, 'deleteGlobalCategory']);
        Route::patch('system-resources/settings/{key}', [SuperAdminController::class, 'updateSystemSetting']);
        Route::patch('devices/{device}/status', [SuperAdminController::class, 'updateDeviceStatus']);
    });

    // Staff management. Gated at the route so a cashier cannot even enumerate.
    Route::middleware('store.access:admin,manager')->group(function () {
        Route::get('store-members', [StoreMemberController::class, 'index']);
        Route::post('store-members', [StoreMemberController::class, 'store']);
        Route::patch('store-members/{member}', [StoreMemberController::class, 'update']);
        Route::delete('store-members/{member}', [StoreMemberController::class, 'destroy']);

        Route::get('store-invites', [StoreMemberController::class, 'invites']);
        Route::post('store-invites', [StoreMemberController::class, 'invite']);
        Route::delete('store-invites/{invite}', [StoreMemberController::class, 'revokeInvite']);
    });

    // Branches belong to the active store and are managed by its admins.
    Route::middleware('store.access:admin')->group(function () {
        Route::get('store-branches', [StoreMemberController::class, 'branches']);
        Route::post('store-branches', [StoreMemberController::class, 'createBranch']);
        Route::patch('store-branches/{branch}', [StoreMemberController::class, 'updateBranch']);
        Route::delete('store-branches/{branch}', [StoreMemberController::class, 'deleteBranch']);
    });
});

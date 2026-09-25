<?php

namespace Tests\Feature;

use Illuminate\Routing\Route as RoutingRoute;
use Illuminate\Support\Facades\Route;
use Tests\TestCase;

/**
 * Architectural guard on the route table.
 *
 * Supabase RLS made a forgotten store filter harmless: the database refused to
 * return another tenant's rows regardless of what the query asked for. Nothing
 * plays that role now. A store-scoped route registered without the store.access
 * middleware exposes every tenant, and it would look completely normal in review.
 *
 * So the check is mechanical: any API route that is not on the explicit
 * allow-list must carry store.access. Adding an unguarded route fails the build.
 */
class RouteGuardTest extends TestCase
{
    /**
     * Routes that legitimately have no single store context.
     *
     * Each one is here for a stated reason. Do not add to this list to silence a
     * failure — a route that handles store data belongs behind the middleware.
     */
    private const NOT_STORE_SCOPED = [
        // Authentication happens before any store is chosen.
        'api/auth/login',
        'api/auth/token',
        'api/auth/me',
        'api/auth/logout',
        // Store discovery: how a client learns which stores it may ask about.
        // Scoped to the caller's own memberships inside the controller.
        'api/stores',
        // Sanctum's own SPA cookie endpoint.
        'sanctum/csrf-cookie',
        // Image elements cannot send X-Store-Id; MediaController authorizes
        // this authenticated read from the store id embedded in the path.
        'api/media/{path}',
        // Platform operations. A super admin acts across tenants by definition,
        // so store.access cannot apply — it would reject the very calls these
        // routes exist to serve. The privilege is verified explicitly in
        // SuperAdminController instead, and SuperAdminTest is what holds that
        // check in place.
        'api/admin/stores',
    ];

    /** @return array<int, RoutingRoute> */
    private function apiRoutes(): array
    {
        return array_values(array_filter(
            Route::getRoutes()->getRoutes(),
            fn (RoutingRoute $r) => str_starts_with($r->uri(), 'api/')
        ));
    }

    public function test_every_store_scoped_api_route_is_behind_the_tenancy_middleware(): void
    {
        $unguarded = [];

        foreach ($this->apiRoutes() as $route) {
            if (in_array($route->uri(), self::NOT_STORE_SCOPED, true) || str_starts_with($route->uri(), 'api/admin/')) {
                continue;
            }

            $hasGuard = collect($route->gatherMiddleware())
                ->contains(fn ($m) => is_string($m) && str_starts_with($m, 'store.access'));

            if (! $hasGuard) {
                $unguarded[] = implode('|', $route->methods()).' '.$route->uri();
            }
        }

        $this->assertSame([], $unguarded,
            "These routes touch store data but are not behind store.access. Without it they return every tenant's rows.");
    }

    public function test_every_api_route_requires_authentication(): void
    {
        $public = ['api/auth/login', 'api/auth/token'];
        $unauthenticated = [];

        foreach ($this->apiRoutes() as $route) {
            if (in_array($route->uri(), $public, true)) {
                continue;
            }

            $hasAuth = collect($route->gatherMiddleware())
                ->contains(fn ($m) => is_string($m) && str_starts_with($m, 'auth:'));

            if (! $hasAuth) {
                $unauthenticated[] = implode('|', $route->methods()).' '.$route->uri();
            }
        }

        $this->assertSame([], $unauthenticated, 'These API routes are reachable without authentication.');
    }

    public function test_staff_management_is_restricted_to_admin_and_manager_at_the_route(): void
    {
        $staffRoutes = array_filter(
            $this->apiRoutes(),
            fn (RoutingRoute $r) => str_starts_with($r->uri(), 'api/store-members')
                || str_starts_with($r->uri(), 'api/store-invites')
        );

        $this->assertNotEmpty($staffRoutes, 'staff routes should exist');

        foreach ($staffRoutes as $route) {
            $this->assertTrue(
                collect($route->gatherMiddleware())->contains('store.access:admin,manager'),
                $route->uri().' must be limited to admin and manager, so a cashier cannot enumerate staff.'
            );
        }
    }

    public function test_authentication_endpoints_are_rate_limited(): void
    {
        foreach (['api/auth/login', 'api/auth/token'] as $uri) {
            $route = collect($this->apiRoutes())->first(fn (RoutingRoute $r) => $r->uri() === $uri);

            $this->assertNotNull($route, "{$uri} should be registered");
            $this->assertTrue(
                collect($route->gatherMiddleware())->contains(fn ($m) => is_string($m) && str_starts_with($m, 'throttle:')),
                "{$uri} must be throttled — it is a credential-guessing target."
            );
        }
    }
}

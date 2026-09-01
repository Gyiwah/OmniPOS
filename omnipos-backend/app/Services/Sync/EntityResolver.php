<?php

namespace App\Services\Sync;

use App\Services\Sync\Handlers\CustomerHandler;
use App\Services\Sync\Handlers\OrderHandler;
use App\Services\Sync\Handlers\PaymentHandler;
use App\Services\Sync\Handlers\PriceHistoryHandler;
use App\Services\Sync\Handlers\ProductBatchHandler;
use App\Services\Sync\Handlers\ProductHandler;
use App\Services\Sync\Handlers\RegisterShiftHandler;
use App\Services\Sync\Handlers\ReturnHandler;
use App\Services\Sync\Handlers\StockMovementHandler;
use Illuminate\Contracts\Container\Container;
use InvalidArgumentException;

/**
 * Maps the entity names the clients send to their handlers.
 *
 * The keys match the `entity` values already used by the mobile sync queue
 * (src/sync/enqueue.ts), so the client needs no vocabulary change when it is
 * repointed from Supabase to this API.
 *
 * Anything not listed here is rejected rather than guessed at: an unrecognised
 * entity name is far more likely to be a client bug or a malicious probe than a
 * table we forgot.
 */
class EntityResolver
{
    /** @var array<string, class-string<EntityHandler>> */
    private const MAP = [
        'products' => ProductHandler::class,
        'customers' => CustomerHandler::class,
        'orders' => OrderHandler::class,
        'product_batches' => ProductBatchHandler::class,
        'stock_movements' => StockMovementHandler::class,
        'price_history' => PriceHistoryHandler::class,
        'register_shifts' => RegisterShiftHandler::class,
        'returns' => ReturnHandler::class,
        // Settlements against a customer's balance only. Tenders taken as part
        // of a sale are written by OrderHandler in the same transaction as the
        // order, and refunds by ReturnHandler as negative rows.
        'payments' => PaymentHandler::class,
    ];

    public function __construct(private readonly Container $container)
    {
    }

    public function supports(string $entity): bool
    {
        return array_key_exists($entity, self::MAP);
    }

    public function for(string $entity): EntityHandler
    {
        if (! $this->supports($entity)) {
            throw new InvalidArgumentException("No sync handler for entity [{$entity}].");
        }

        return $this->container->make(self::MAP[$entity]);
    }

    /** @return array<int, string> */
    public function entities(): array
    {
        return array_keys(self::MAP);
    }
}

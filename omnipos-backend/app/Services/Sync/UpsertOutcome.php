<?php

namespace App\Services\Sync;

/**
 * Result of applying one sync operation.
 *
 * A conflict is a normal, expected outcome — not an exception. Offline clients
 * will routinely send work the server cannot accept as-is (an order number
 * another till already used, an edit to a product deleted meanwhile). Modelling
 * that as a return value rather than a thrown error keeps the rest of the batch
 * processing normally.
 */
final class UpsertOutcome
{
    private function __construct(
        public readonly ?array $result,
        public readonly ?string $reason,
        public readonly ?array $serverState,
    ) {
    }

    public static function applied(array $result): self
    {
        return new self($result, null, null);
    }

    public static function conflict(string $reason, ?array $serverState = null): self
    {
        return new self(null, $reason, $serverState);
    }

    public function isConflict(): bool
    {
        return $this->reason !== null;
    }
}

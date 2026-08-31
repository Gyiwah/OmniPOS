<?php

return [
    'sync' => [
        /*
         * How long a change must have been committed before a client may pull it.
         *
         * bigserial assigns sequence numbers at INSERT time but rows become
         * visible at COMMIT time, and those orders can differ. Without this delay
         * a client can advance its cursor past a sequence that has not committed
         * yet and never see that change again. See SyncService::stabilityCutoff().
         *
         * Raise it if the database sees long-running write transactions.
         */
        'stability_window_ms' => (int) env('OMNIPOS_SYNC_STABILITY_WINDOW_MS', 1000),

        'default_pull_limit' => 500,
        'max_pull_limit' => 1000,
        'max_push_operations' => 500,
    ],

    'inventory' => [
        /*
         * Whether to reject a sale that would drive stock negative.
         *
         * Off by default, and that is deliberate. An offline terminal pushes
         * sales that have already happened and been receipted; refusing them
         * because another till sold the last unit first would discard real
         * revenue. Oversells surface through InventoryService::oversoldProducts()
         * for a human to reconcile instead.
         */
        'reject_negative_stock' => (bool) env('OMNIPOS_REJECT_NEGATIVE_STOCK', false),
    ],
];

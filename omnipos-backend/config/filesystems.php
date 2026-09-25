<?php

return [
    'default' => env('FILESYSTEM_DISK', 'local'),

    'disks' => [
        'local' => [
            'driver' => 'local',
            'root' => storage_path('app/private'),
            'throw' => true,
        ],

        's3' => [
            'driver' => 's3',
            'key' => env('AWS_ACCESS_KEY_ID'),
            'secret' => env('AWS_SECRET_ACCESS_KEY'),
            'region' => env('AWS_REGION') ?: env('AWS_DEFAULT_REGION') ?: 'us-east-2',
            'bucket' => env('AWS_BUCKET') ?: 'omnipos-assets',
            'endpoint' => env('AWS_ENDPOINT_URL_S3') ?: env('AWS_ENDPOINT'),
            'use_path_style_endpoint' => true,
            'throw' => true,
        ],
    ],
];
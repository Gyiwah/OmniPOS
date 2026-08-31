import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";

const BACKEND = "http://127.0.0.1:8000";

/**
 * Vite's proxy answers 500 when the backend refuses the connection, which is
 * indistinguishable from the application itself failing. 503 is the honest
 * status for "upstream is down", and it lets the client treat a stopped backend
 * as offline rather than showing the cashier a server error.
 */
function reportBackendDown(proxy: { on: (e: string, cb: (err: unknown, req: unknown, res: unknown) => void) => void }) {
  proxy.on("error", (_err, _req, res) => {
    const response = res as { writableEnded?: boolean; writeHead?: (c: number, h: Record<string, string>) => void; end?: (b: string) => void };
    if (!response?.writeHead || response.writableEnded) return;
    response.writeHead(503, { "Content-Type": "application/json" });
    response.end?.(JSON.stringify({ message: "Backend unavailable" }));
  });
}

export default defineConfig({
  define: {
    // Surfaced to the API on device registration, so support can tell which
    // build a till is running.
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? "0.0.0"),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "favicon-16x16.png", "favicon-32x32.png", "apple-touch-icon.png"],
      manifest: {
        name: "OmniPOS",
        short_name: "OmniPOS",
        description: "Offline-first point of sale",
        theme_color: "#0f172a",
        background_color: "#0f172a",
        display: "standalone",
        orientation: "any",
        start_url: "/",
        icons: [
          /*
           * purpose "any" only, deliberately. The logo is edge-to-edge on a
           * transparent canvas with no safe-zone padding, so declaring it
           * maskable would let Android crop the blue arc off. A maskable variant
           * needs its own artwork with ~20% padding, not a reuse of these.
           */
          { src: "android-chrome-192x192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "android-chrome-512x512.png", sizes: "512x512", type: "image/png", purpose: "any" },
        ],
      },
      workbox: {
        // The app shell is cached so the till opens with no network at all.
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
        // API responses are deliberately NOT cached by the service worker.
        // Offline reads come from IndexedDB, which is a real database the sync
        // engine maintains — a stale HTTP cache pretending to be data would
        // silently disagree with it.
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  server: {
    port: 5173,
    proxy: {
      // Same-origin in development so the Sanctum session cookie is first-party.
      "/api": { target: BACKEND, changeOrigin: true, configure: reportBackendDown },
      "/sanctum": { target: BACKEND, changeOrigin: true, configure: reportBackendDown },
    },
  },
  // `vite preview` does not inherit server.proxy. Without this the production
  // build cannot reach the API, and the service worker can only ever be tested
  // against a shell with no data behind it.
  preview: {
    port: 4173,
    proxy: {
      "/api": { target: BACKEND, changeOrigin: true, configure: reportBackendDown },
      "/sanctum": { target: BACKEND, changeOrigin: true, configure: reportBackendDown },
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./src/test/setup.ts"],
  },
});

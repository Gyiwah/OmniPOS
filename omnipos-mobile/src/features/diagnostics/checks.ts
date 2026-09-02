import { Q } from "@nozbe/watermelondb";
import { database } from "@/src/database";
import SyncQueueItem from "@/src/database/models/SyncQueueItem";
import { getSecureStorage } from "@/src/core/platform";
import { API_BASE_URL, usingLaravel } from "@/src/core/api/config";
import { api, ApiError, getToken } from "@/src/core/api/client";

/**
 * What a device can tell you about itself.
 *
 * Hardware testing goes wrong in ways a simulator never shows, and almost all of
 * them present identically: "network request failed", which this app reports as
 * "offline". A till that looks like it is happily working offline is the single
 * most expensive failure to diagnose, because nothing is visibly wrong.
 *
 * So each check here answers one question, and a failure carries the remedy
 * rather than the symptom. Read top to bottom: the later checks assume the
 * earlier ones passed.
 */

export type CheckStatus = "pass" | "fail" | "warn" | "skip";

export type CheckResult = {
  id: string;
  title: string;
  status: CheckStatus;
  detail: string;
  /** What to do about it. Absent when there is nothing to do. */
  remedy?: string;
  ms?: number;
};

const TIMEOUT_MS = 8000;

async function timed<T>(run: () => Promise<T>): Promise<{ value?: T; error?: unknown; ms: number }> {
  const started = Date.now();
  try {
    return { value: await run(), ms: Date.now() - started };
  } catch (error) {
    return { error, ms: Date.now() - started };
  }
}

/** A fetch that gives up, so a black-holed LAN address cannot hang the screen. */
async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function checkBackend(): CheckResult {
  if (!usingLaravel) {
    return {
      id: "backend",
      title: "Backend",
      status: "warn",
      detail: "This build talks to Supabase.",
      remedy: "Set EXPO_PUBLIC_BACKEND=laravel and rebuild to test the new API.",
    };
  }

  return { id: "backend", title: "Backend", status: "pass", detail: "Laravel" };
}

/**
 * The mistake that wastes the first hour: localhost on a phone is the phone.
 */
function checkUrl(): CheckResult {
  if (!usingLaravel) {
    return { id: "url", title: "API address", status: "skip", detail: "Not a Laravel build." };
  }

  if (!API_BASE_URL) {
    return {
      id: "url",
      title: "API address",
      status: "fail",
      detail: "EXPO_PUBLIC_API_URL is not set.",
      remedy: "Set it to the server's LAN address, e.g. http://192.168.1.10:8000, and rebuild.",
    };
  }

  if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(API_BASE_URL)) {
    return {
      id: "url",
      title: "API address",
      status: "fail",
      detail: `${API_BASE_URL} points at this device, not your computer.`,
      remedy: "Use the machine's LAN address. `ipconfig` on Windows, `ifconfig` on macOS.",
    };
  }

  return { id: "url", title: "API address", status: "pass", detail: API_BASE_URL };
}

/**
 * Reachability, and — more usefully — which kind of unreachable.
 *
 * An unauthenticated GET is the right probe: 401 proves the server is there,
 * routing, and is this API. Anything else distinguishes a blocked scheme from a
 * wrong address from a captive portal.
 */
async function checkReachable(): Promise<CheckResult> {
  if (!usingLaravel || !API_BASE_URL) {
    return { id: "reach", title: "Server reachable", status: "skip", detail: "No address to try." };
  }

  const { value, error, ms } = await timed(() =>
    fetchWithTimeout(`${API_BASE_URL}/api/auth/me`, { headers: { Accept: "application/json" } }),
  );

  if (error) {
    const message = error instanceof Error ? error.message : String(error);
    const aborted = error instanceof Error && error.name === "AbortError";

    /*
     * Android and iOS both refuse plain HTTP by default, and the error text is
     * the only clue. Naming it here is the difference between a five-minute fix
     * and an afternoon.
     */
    const cleartext = /cleartext|ATS|App Transport|not permitted|policy/i.test(message);

    return {
      id: "reach",
      title: "Server reachable",
      status: "fail",
      ms,
      detail: aborted ? `No answer within ${TIMEOUT_MS / 1000}s.` : message,
      remedy: cleartext
        ? "The platform blocked plain HTTP. Rebuild — app.config.ts allows it for non-production builds — or serve the API over HTTPS."
        : aborted
          ? "The address resolves but nothing answered. Check the server is running and bound to 0.0.0.0, not 127.0.0.1, and that the firewall allows the port."
          : "Check the device is on the same network, and that the address and port are right.",
    };
  }

  const response = value!;

  // 401 is the healthy answer here: it means Laravel routed the request.
  if (response.status === 401 || response.status === 200) {
    return {
      id: "reach",
      title: "Server reachable",
      status: "pass",
      ms,
      detail: `Answered ${response.status} in ${ms}ms.`,
    };
  }

  const isHtml = (response.headers.get("content-type") ?? "").includes("text/html");

  return {
    id: "reach",
    title: "Server reachable",
    status: "fail",
    ms,
    detail: `Answered ${response.status}${isHtml ? " with HTML" : ""}.`,
    remedy: isHtml
      ? "Something answered but it is not this API — often a router's login page. Check the address."
      : "Reached a server, but not one serving /api/auth/me. Check the address and that the API is deployed.",
  };
}

/**
 * A phone with a wrong clock mis-dates every sale it takes.
 *
 * client_created_at is what every report is grouped by, and it comes from the
 * device. A till an hour out files a morning's takings under yesterday, and
 * nothing anywhere flags it.
 */
async function checkClock(): Promise<CheckResult> {
  if (!usingLaravel || !API_BASE_URL) {
    return { id: "clock", title: "Clock", status: "skip", detail: "Needs the server." };
  }

  const { value, error } = await timed(() =>
    fetchWithTimeout(`${API_BASE_URL}/api/auth/me`, { headers: { Accept: "application/json" } }),
  );

  if (error || !value) {
    return { id: "clock", title: "Clock", status: "skip", detail: "Could not reach the server." };
  }

  const header = value.headers.get("date");
  if (!header) {
    return { id: "clock", title: "Clock", status: "skip", detail: "The server sent no Date header." };
  }

  const skewMs = Date.now() - new Date(header).getTime();
  const skew = Math.round(Math.abs(skewMs) / 1000);

  // A second or two is ordinary. A minute is a wrong clock, not latency.
  if (skew <= 30) {
    return { id: "clock", title: "Clock", status: "pass", detail: `Within ${skew}s of the server.` };
  }

  return {
    id: "clock",
    title: "Clock",
    status: skew > 300 ? "fail" : "warn",
    detail: `This device is ${skew}s ${skewMs > 0 ? "ahead of" : "behind"} the server.`,
    remedy: "Turn on automatic date and time on the device. Sales are timestamped here, and reports group by that.",
  };
}

/** The token lives in the keychain. If that is unavailable, sign-in will not persist. */
async function checkSecureStore(): Promise<CheckResult> {
  const secure = getSecureStorage();

  if (!secure) {
    return {
      id: "secure",
      title: "Secure storage",
      status: "warn",
      detail: "No keychain on this platform; the token falls back to ordinary storage.",
    };
  }

  const key = "omnipos.diagnostics";
  const written = `probe-${Date.now()}`;

  const { error } = await timed(async () => {
    await secure.setItem(key, written);
    const read = await secure.getItem(key);
    await secure.setItem(key, "");
    if (read !== written) throw new Error(`wrote ${written}, read back ${read ?? "nothing"}`);
  });

  if (error) {
    return {
      id: "secure",
      title: "Secure storage",
      status: "fail",
      detail: error instanceof Error ? error.message : String(error),
      remedy: "The device keychain refused. On Android this usually means no screen lock is set.",
    };
  }

  return { id: "secure", title: "Secure storage", status: "pass", detail: "Wrote and read back a value." };
}

async function checkLocalDatabase(): Promise<CheckResult> {
  const { value, error, ms } = await timed(async () => {
    const products = await database.get("products").query().fetchCount();
    const orders = await database.get("orders").query().fetchCount();
    return { products, orders };
  });

  if (error) {
    return {
      id: "db",
      title: "Local database",
      status: "fail",
      detail: error instanceof Error ? error.message : String(error),
      remedy: "WatermelonDB could not be read. This is a development build problem, not a network one.",
    };
  }

  return {
    id: "db",
    title: "Local database",
    status: "pass",
    ms,
    detail: `${value!.products} products, ${value!.orders} sales held on this device.`,
  };
}

async function checkAuth(): Promise<CheckResult> {
  if (!usingLaravel) {
    return { id: "auth", title: "Signed in", status: "skip", detail: "Not a Laravel build." };
  }

  const token = await getToken();
  if (!token) {
    return {
      id: "auth",
      title: "Signed in",
      status: "warn",
      detail: "No token stored on this device.",
      remedy: "Sign in, then run these checks again to test the authenticated paths.",
    };
  }

  const { error, ms } = await timed(() => api.get("/api/auth/me", undefined, { storeless: true }));

  if (error) {
    const unauthenticated = error instanceof ApiError && error.isUnauthenticated;

    return {
      id: "auth",
      title: "Signed in",
      status: "fail",
      ms,
      detail: error instanceof Error ? error.message : String(error),
      remedy: unauthenticated
        ? "The stored token was refused. Sign out and in again."
        : "The server could not be asked. Fix the reachability check first.",
    };
  }

  return { id: "auth", title: "Signed in", status: "pass", ms, detail: "The stored token was accepted." };
}

/** The protocol itself, end to end, without writing anything. */
async function checkSyncProtocol(storeId: string | null): Promise<CheckResult> {
  if (!usingLaravel) {
    return { id: "sync", title: "Sync protocol", status: "skip", detail: "Not a Laravel build." };
  }

  if (!storeId) {
    return { id: "sync", title: "Sync protocol", status: "skip", detail: "No store selected." };
  }

  const { value, error, ms } = await timed(() =>
    api.get<{ cursor: number }>("/api/sync/pull", { cursor: 0, limit: 1 }),
  );

  if (error) {
    return {
      id: "sync",
      title: "Sync protocol",
      status: "fail",
      ms,
      detail: error instanceof Error ? error.message : String(error),
      remedy:
        error instanceof ApiError && error.status === 403
          ? "The server refused this store. Check the signed-in account is a member of it."
          : "Fix the reachability and sign-in checks first.",
    };
  }

  return {
    id: "sync",
    title: "Sync protocol",
    status: "pass",
    ms,
    detail: `Server changefeed is at ${value?.cursor ?? 0}.`,
  };
}

/**
 * Anything stuck. A queue that never drains is the symptom every other check
 * here exists to explain.
 */
async function checkQueue(storeId: string | null): Promise<CheckResult> {
  if (!storeId) {
    return { id: "queue", title: "Outbox", status: "skip", detail: "No store selected." };
  }

  const { value, error } = await timed(async () => {
    const rows = await database
      .get<SyncQueueItem>("sync_queue")
      .query(Q.where("store_id", storeId))
      .fetch();

    return {
      pending: rows.filter((r) => r.status === "pending").length,
      conflict: rows.filter((r) => r.status === "conflict").length,
      failed: rows.filter((r) => r.status === "failed").length,
    };
  });

  if (error) {
    return { id: "queue", title: "Outbox", status: "fail", detail: String(error) };
  }

  const { pending, conflict, failed } = value!;

  if (conflict > 0 || failed > 0) {
    return {
      id: "queue",
      title: "Outbox",
      status: "warn",
      detail: `${pending} waiting, ${conflict} rejected, ${failed} failed.`,
      remedy: conflict > 0 ? "Settle the rejected sales under Settings → Rejected Sales." : undefined,
    };
  }

  return {
    id: "queue",
    title: "Outbox",
    status: "pass",
    detail: pending === 0 ? "Everything has reached the server." : `${pending} waiting to send.`,
  };
}

/**
 * Every check, in order. Later ones depend on earlier ones, so they are run
 * sequentially rather than in parallel — a failure list that reads top to bottom
 * is worth more than one that arrives quickly.
 */
export async function runDiagnostics(storeId: string | null): Promise<CheckResult[]> {
  const results: CheckResult[] = [checkBackend(), checkUrl()];

  results.push(await checkReachable());
  results.push(await checkClock());
  results.push(await checkSecureStore());
  results.push(await checkLocalDatabase());
  results.push(await checkAuth());
  results.push(await checkSyncProtocol(storeId));
  results.push(await checkQueue(storeId));

  return results;
}

/** A one-line summary, for pasting into a bug report. */
export function summarise(results: CheckResult[]): string {
  const counts = results.reduce<Record<CheckStatus, number>>(
    (acc, r) => ({ ...acc, [r.status]: acc[r.status] + 1 }),
    { pass: 0, fail: 0, warn: 0, skip: 0 },
  );

  return `${counts.pass} passed, ${counts.fail} failed, ${counts.warn} to check, ${counts.skip} skipped`;
}

/** Everything, as text, so a tester can send it without a screenshot. */
export function asReport(results: CheckResult[]): string {
  const lines = results.map((r) => {
    const mark = r.status === "pass" ? "OK  " : r.status === "fail" ? "FAIL" : r.status === "warn" ? "WARN" : "SKIP";
    const timing = r.ms === undefined ? "" : ` (${r.ms}ms)`;
    return `${mark} ${r.title}: ${r.detail}${timing}${r.remedy ? `\n       → ${r.remedy}` : ""}`;
  });

  return [
    `OmniPOS device check — ${new Date().toISOString()}`,
    `API: ${API_BASE_URL || "(not set)"}`,
    "",
    ...lines,
    "",
    summarise(results),
  ].join("\n");
}

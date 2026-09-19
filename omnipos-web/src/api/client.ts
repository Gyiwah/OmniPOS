/**
 * HTTP client for the OmniPOS Laravel API.
 *
 * Authentication is a Sanctum SPA cookie session, not a bearer token. That means
 * two things this client has to get right:
 *
 *  1. every request sends credentials, or the session is invisible;
 *  2. state-changing requests carry the XSRF-TOKEN cookie back as a header,
 *     which is what makes Laravel's CSRF protection pass.
 *
 * The store context travels in an X-Store-Id header. The server does not trust
 * it — EnsureStoreAccess verifies membership before anything reads it — but
 * every store-scoped route needs it present.
 */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** Session expired or never established. */
  get isUnauthenticated(): boolean {
    return this.status === 401 || this.status === 419;
  }

  get isValidation(): boolean {
    return this.status === 422;
  }

  /** No response at all — offline, DNS failure, server down. */
  get isNetwork(): boolean {
    return this.status === 0;
  }

  /**
   * The request never reached the application, so retrying later is the right
   * response rather than surfacing an error to the cashier.
   *
   * Covers a bare fetch failure (status 0) and the gateway statuses a reverse
   * proxy returns when the backend is down. Without the gateway cases, a shop
   * behind nginx sees "Request failed with status 502" during an outage instead
   * of "offline" — the queued sale is safe either way, but the message is
   * alarming and wrong.
   *
   * 500 is deliberately excluded: it usually means the application itself
   * failed, and silently retrying a genuine server error would hide a bug.
   */
  get isUnreachable(): boolean {
    return this.status === 0 || this.status === 502 || this.status === 503 || this.status === 504;
  }
}

let activeStoreId: string | null = null;

export function setActiveStore(storeId: string | null): void {
  activeStoreId = storeId;
}

export function getActiveStore(): string | null {
  return activeStoreId;
}

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp("(^|; )" + name + "=([^;]*)"));
  return match ? decodeURIComponent(match[2]) : null;
}

let csrfPrimed = false;

/**
 * Sanctum issues the XSRF-TOKEN cookie from this endpoint. It must be fetched
 * once before the first state-changing request of a session, or Laravel rejects
 * the POST with a 419 that looks like an authentication failure.
 */
export async function primeCsrf(force = false): Promise<void> {
  if (csrfPrimed && !force && readCookie("XSRF-TOKEN")) return;
  // Same-origin on purpose. Vite (or the production reverse proxy) forwards
  // /sanctum to the Laravel host so the session cookie stays first-party.
  await fetch("/sanctum/csrf-cookie", { credentials: "include" });
  csrfPrimed = true;
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Skip the store header for routes with no store context (login, store list). */
  storeless?: boolean;
  signal?: AbortSignal;
};

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, query, storeless = false, signal } = options;

  const url = new URL(path, globalThis.location?.origin ?? "http://localhost");
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-Requested-With": "XMLHttpRequest",
  };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (!storeless && activeStoreId) {
    headers["X-Store-Id"] = activeStoreId;
  }

  if (method !== "GET" && method !== "HEAD") {
    await primeCsrf();
    const token = readCookie("XSRF-TOKEN");
    if (token) headers["X-XSRF-TOKEN"] = token;
  }

  let response: Response;
  try {
    response = await fetch(url.pathname + url.search, {
      method,
      headers,
      credentials: "include",
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (cause) {
    // Distinguished from an HTTP error so callers can treat it as "offline,
    // try later" rather than "the server rejected this, do not retry".
    throw new ApiError(0, cause instanceof Error ? cause.message : "Network request failed");
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!response.ok) {
    const message =
      (parsed && typeof parsed === "object" && "message" in parsed
        ? String((parsed as { message: unknown }).message)
        : null) ?? `Request failed with status ${response.status}`;

    throw new ApiError(response.status, message, parsed);
  }

  return parsed as T;
}

export const api = {
  get: <T>(path: string, query?: RequestOptions["query"], opts?: RequestOptions) =>
    request<T>(path, { ...opts, method: "GET", query }),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>(path, { ...opts, method: "POST", body }),
  patch: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>(path, { ...opts, method: "PATCH", body }),
  delete: <T>(path: string, opts?: RequestOptions) => request<T>(path, { ...opts, method: "DELETE" }),
};

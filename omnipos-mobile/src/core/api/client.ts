import { getSecureStorage, storage } from "@/src/core/platform";
import { API_BASE_URL } from "./config";

/**
 * HTTP client for the OmniPOS Laravel API.
 *
 * The mobile app authenticates with a Sanctum bearer token rather than the
 * cookie session the web till uses. A native app has no cookie jar shared with a
 * browser, and a long-lived token survives the app being backgrounded for days —
 * which matters for a till that may not be opened over a weekend.
 *
 * The token is a credential, so it lives in the OS keychain where the platform
 * provides one, and only falls back to ordinary storage where it does not.
 */

const TOKEN_KEY = "omnipos.api_token";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }

  get isUnauthenticated(): boolean {
    return this.status === 401;
  }

  get isValidation(): boolean {
    return this.status === 422;
  }

  /**
   * The request never reached the application, so retrying later is right.
   * Covers a bare network failure and the gateway statuses a reverse proxy
   * returns while the backend is down — a till behind nginx during an outage
   * should read as "offline", not as a server error.
   */
  get isUnreachable(): boolean {
    return this.status === 0 || this.status === 502 || this.status === 503 || this.status === 504;
  }
}

let cachedToken: string | null = null;
let activeStoreId: string | null = null;

export function setActiveStore(storeId: string | null): void {
  activeStoreId = storeId;
}

export async function getToken(): Promise<string | null> {
  if (cachedToken) return cachedToken;

  const secure = getSecureStorage();
  cachedToken = secure ? await secure.getItem(TOKEN_KEY) : await storage.getItem(TOKEN_KEY);

  return cachedToken;
}

export async function setToken(token: string | null): Promise<void> {
  cachedToken = token;

  const secure = getSecureStorage();

  if (token === null) {
    if (secure) await secure.setItem(TOKEN_KEY, "");
    await storage.removeItem(TOKEN_KEY);
    return;
  }

  if (secure) await secure.setItem(TOKEN_KEY, token);
  else await storage.setItem(TOKEN_KEY, token);
}

export function hasCachedToken(): boolean {
  return cachedToken !== null && cachedToken !== "";
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Routes with no store context: login, store list. */
  storeless?: boolean;
  /** Endpoints reachable before a token exists. */
  anonymous?: boolean;
  signal?: AbortSignal;
};

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, query, storeless = false, anonymous = false, signal } = options;

  let url = `${API_BASE_URL}${path}`;
  if (query) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  if (body !== undefined) headers["Content-Type"] = "application/json";

  if (!anonymous) {
    const token = await getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  // The server does not trust this — EnsureStoreAccess verifies membership
  // before anything reads it — but every store-scoped route needs it present.
  if (!storeless && activeStoreId) headers["X-Store-Id"] = activeStoreId;

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (cause) {
    // Distinguished from an HTTP error so callers can treat it as "offline, try
    // later" rather than "the server rejected this, do not retry".
    throw new ApiError(0, cause instanceof Error ? cause.message : "Network request failed");
  }

  if (response.status === 204) return undefined as T;

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

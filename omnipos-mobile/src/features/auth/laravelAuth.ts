import { api, setActiveStore, setToken } from "@/src/core/api/client";
import { storage } from "@/src/core/platform";
import { SYNC_STORAGE } from "@/src/sync/keys";

/**
 * Authentication against the Laravel API.
 *
 * Replaces Supabase GoTrue. The mobile app uses a Sanctum bearer token rather
 * than the cookie session the web till uses: a native app has no shared cookie
 * jar, and a long-lived token survives the app being backgrounded for days,
 * which matters for a till that may not be opened over a weekend.
 */

export type Membership = { store_id: string; role: "admin" | "manager" | "cashier" };

export type AuthedUser = {
  id: string;
  name: string;
  email: string;
  is_super_admin: boolean;
};

export type SignInResult = {
  userId: string;
  storeId: string | null;
  role: string | null;
  isSuperAdmin: boolean;
  memberships: Membership[];
};

/**
 * A stable name for this installation's token.
 *
 * The server revokes any existing token with the same name on sign-in, so a
 * till that is re-authenticated does not accumulate tokens, and signing out on
 * one device does not revoke another's.
 */
async function deviceTokenName(): Promise<string> {
  const existing = await storage.getItem("omnipos_laravel_device_id");
  return `mobile:${existing ?? "unregistered"}`;
}

export async function signIn(email: string, password: string): Promise<SignInResult> {
  const res = await api.post<{ token: string; user: AuthedUser; memberships: Membership[] }>(
    "/api/auth/token",
    { email: email.trim(), password, device_name: await deviceTokenName() },
    { anonymous: true, storeless: true },
  );

  await setToken(res.token);

  return finishSession(res.user, res.memberships);
}

/**
 * Re-establish the session from the stored token.
 *
 * Returns null when there is no usable token, which is a normal cold start on a
 * fresh install — not an error.
 */
export async function restoreSession(): Promise<SignInResult | null> {
  try {
    const res = await api.get<{ user: AuthedUser; memberships: Membership[] }>("/api/auth/me", undefined, {
      storeless: true,
    });

    return finishSession(res.user, res.memberships);
  } catch {
    // Offline, or the token has been revoked. The caller falls back to its
    // cached session so the till still opens and can keep selling.
    return null;
  }
}

async function finishSession(user: AuthedUser, memberships: Membership[]): Promise<SignInResult> {
  const remembered = await storage.getItem(SYNC_STORAGE.activeStoreId);

  // Prefer the store this device was last used for; a cashier who moves between
  // branches should not silently start ringing sales into the wrong one.
  const storeId =
    (remembered && memberships.some((m) => m.store_id === remembered) ? remembered : null) ??
    memberships[0]?.store_id ??
    null;

  if (storeId) {
    setActiveStore(storeId);
    await storage.setItem(SYNC_STORAGE.activeStoreId, storeId);
  }

  return {
    userId: user.id,
    storeId,
    role: memberships.find((m) => m.store_id === storeId)?.role ?? (user.is_super_admin ? "super_admin" : null),
    isSuperAdmin: user.is_super_admin,
    memberships,
  };
}

/**
 * Sign out.
 *
 * The local token is cleared first and unconditionally. A till that cannot reach
 * the server must still be able to lock itself; failing to sign out because the
 * network is down would leave the previous cashier's session open on a shared
 * device.
 */
export async function signOut(): Promise<void> {
  try {
    await api.post("/api/auth/logout", undefined, { storeless: true });
  } catch {
    // Best effort. The token expires server-side regardless.
  } finally {
    await setToken(null);
    setActiveStore(null);
  }
}

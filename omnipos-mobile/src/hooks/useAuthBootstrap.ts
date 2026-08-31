import { storage } from "@/src/core/platform";
import { useEffect } from "react";

import { supabase } from "@/src/services/supabase";
import { SYNC_STORAGE } from "@/src/sync/keys";
import { useAuthStore } from "@/src/store/authStore";
import { useBootstrapStore } from "@/src/store/bootstrapStore";
import { useStoreSlice } from "@/src/store/storeSlice";
import { usingLaravel } from "@/src/core/api/config";
import { restoreSession } from "@/src/features/auth/laravelAuth";

const AUTH_CACHE_KEY = "omnipos:cached_auth_session";

type CachedAuthSession = {
  userId: string;
  role: string | null;
  isSuperAdmin: boolean;
  storeId: string | null;
};

/** Restore Supabase session + active store from persistent storage on cold start. */
export function useAuthBootstrap(): void {
  const setReady = useBootstrapStore((s) => s.setReady);

  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      // 1. FAST LOCAL HYDRATION: Restore cached credentials immediately (instant offline access)
      try {
        const rawCached = await storage.getItem(AUTH_CACHE_KEY);
        if (rawCached) {
          const cached = JSON.parse(rawCached) as CachedAuthSession;
          if (cached?.userId) {
            useAuthStore.getState().setSession(cached.userId, cached.role as any, cached.isSuperAdmin);
            if (cached.storeId && !useStoreSlice.getState().activeStoreId) {
              useStoreSlice.getState().setActiveStore(cached.storeId);
            }
          }
        }
      } catch {
        // ignore cache read error
      }

      // Also restore active store ID from SYNC_STORAGE
      try {
        const storedStoreId = await storage.getItem(SYNC_STORAGE.activeStoreId);
        if (storedStoreId && !useStoreSlice.getState().activeStoreId) {
          useStoreSlice.getState().setActiveStore(storedStoreId);
        }
      } catch {
        // ignore
      }

      // 2. REMOTE VERIFICATION & REFRESH (Graceful offline fallback)
      try {
        if (usingLaravel) {
          // The token is the session. restoreSession returns null when it is
          // missing, revoked, or simply unreachable — all of which leave the
          // cached session above in place so the till still opens and sells.
          const restored = await restoreSession();

          if (restored) {
            useAuthStore
              .getState()
              .setSession(restored.userId, restored.role as any, restored.isSuperAdmin);

            if (restored.storeId && !useStoreSlice.getState().activeStoreId) {
              useStoreSlice.getState().setActiveStore(restored.storeId);
            }

            void storage.setItem(
              AUTH_CACHE_KEY,
              JSON.stringify({
                userId: restored.userId,
                role: restored.role,
                isSuperAdmin: restored.isSuperAdmin,
                storeId: restored.storeId,
              }),
            );
          }
        } else {
          const { data: sessionData } = await supabase.auth.getSession();
          const session = sessionData?.session;

          if (session?.user) {
            const userId = session.user.id;

            try {
              await supabase.rpc("accept_pending_store_invites");
            } catch {
              // Ignore if RPC fails during offline state
            }

            let membershipRole: string | null = null;
            let remoteStoreId: string | null = null;
            let isSuperAdmin = false;

            try {
              const { data: memberships } = await supabase
                .from("store_members")
                .select("store_id, role")
                .eq("user_id", userId)
                .limit(1);

              const membership = memberships?.[0];
              if (membership) {
                membershipRole = membership.role;
                remoteStoreId = membership.store_id;
              }
            } catch {
              // Offline: retain existing role
              membershipRole = useAuthStore.getState().role;
            }

            try {
              const { data: profile } = await supabase
                .from("profiles")
                .select("is_super_admin")
                .eq("id", userId)
                .maybeSingle();

              isSuperAdmin = Boolean(profile?.is_super_admin);
            } catch {
              isSuperAdmin = useAuthStore.getState().isSuperAdmin;
            }

            const resolvedRole = membershipRole ?? (isSuperAdmin ? "super_admin" : null);
            useAuthStore.getState().setSession(userId, resolvedRole as any, isSuperAdmin);

            const storedStoreId = await storage.getItem(SYNC_STORAGE.activeStoreId);
            const resolvedStoreId = storedStoreId ?? remoteStoreId ?? useStoreSlice.getState().activeStoreId;
            if (resolvedStoreId && !useStoreSlice.getState().activeStoreId) {
              useStoreSlice.getState().setActiveStore(resolvedStoreId);
            }

            void storage.setItem(
              AUTH_CACHE_KEY,
              JSON.stringify({
                userId,
                role: resolvedRole,
                isSuperAdmin,
                storeId: resolvedStoreId,
              }),
            );
          }
        }
      } catch (error) {
        if (__DEV__) {
          const message = error instanceof Error ? error.message : "auth refresh notice";
          // Notice only if not network related
          if (!message.toLowerCase().includes("network")) {
            console.warn(`[OmniPOS] Auth refresh notice: ${message}`);
          }
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    }

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [setReady]);
}

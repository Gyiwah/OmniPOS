import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect } from "react";

import { supabase } from "@/src/services/supabase";
import { SYNC_STORAGE } from "@/src/sync/keys";
import { useAuthStore } from "@/src/store/authStore";
import { useBootstrapStore } from "@/src/store/bootstrapStore";
import { useStoreSlice } from "@/src/store/storeSlice";

/** Restore Supabase session + active store from persistent storage on cold start. */
export function useAuthBootstrap(): void {
  const setReady = useBootstrapStore((s) => s.setReady);

  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      try {
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;

        const session = sessionData.session;
        if (session?.user) {
          const userId = session.user.id;

          try {
            await supabase.rpc("accept_pending_store_invites");
          } catch {
            // Ignore if RPC fails during offline state
          }

          const { data: memberships, error: membershipError } = await supabase
            .from("store_members")
            .select("store_id, role")
            .eq("user_id", userId)
            .limit(1);

          if (membershipError) throw membershipError;

          const { data: profile } = await supabase
            .from("profiles")
            .select("is_super_admin")
            .eq("id", userId)
            .maybeSingle();

          const isSuperAdmin = Boolean(profile?.is_super_admin);

          const membership = memberships?.[0];
          if (membership) {
            useAuthStore.getState().setSession(userId, membership.role, isSuperAdmin);
          } else {
            useAuthStore.getState().setSession(userId, isSuperAdmin ? "super_admin" : null, isSuperAdmin);
          }

          const storedStoreId = await AsyncStorage.getItem(SYNC_STORAGE.activeStoreId);
          const resolvedStoreId = storedStoreId ?? membership?.store_id ?? null;
          if (resolvedStoreId && !useStoreSlice.getState().activeStoreId) {
            useStoreSlice.getState().setActiveStore(resolvedStoreId);
          }
        } else {
          // Offline / local start: restore stored store ID if available
          const storedStoreId = await AsyncStorage.getItem(SYNC_STORAGE.activeStoreId);
          if (storedStoreId && !useStoreSlice.getState().activeStoreId) {
            useStoreSlice.getState().setActiveStore(storedStoreId);
          }
        }
      } catch (error) {
        if (__DEV__) {
          const message = error instanceof Error ? error.message : "auth bootstrap failed";
          // eslint-disable-next-line no-console -- operator-facing bootstrap diagnostics
          console.warn(`[OmniPOS] Auth bootstrap failed: ${message}`);
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

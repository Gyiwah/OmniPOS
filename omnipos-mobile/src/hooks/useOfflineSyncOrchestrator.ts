import { network, storage } from "@/src/core/platform";

import { useEffect } from "react";
import { AppState } from "react-native";

import { getOrCreateOfflineEncryptionMaterial } from "@/src/database/encryptionKey";
import { registerBackgroundSync } from "@/src/sync/backgroundSyncRegistration";
import { runSyncCycle } from "@/src/sync/syncEngine";
import { SYNC_STORAGE } from "@/src/sync/keys";
import { refreshPendingSyncCount } from "@/src/sync/syncCounters";
import { useStoreSlice } from "@/src/store/storeSlice";

/**
 * Connectivity + AppState + initial hydration hooks for OmniPOS offline engine.
 */
export function useOfflineSyncOrchestrator(appReady = true): void {
  const activeStoreId = useStoreSlice((s) => s.activeStoreId);

  useEffect(() => {
    if (!appReady) return;
    void getOrCreateOfflineEncryptionMaterial();
    void refreshPendingSyncCount();
    void registerBackgroundSync();
  }, [appReady]);

  useEffect(() => {
    if (!appReady || !activeStoreId) return;
    void storage.setItem(SYNC_STORAGE.activeStoreId, activeStoreId);
  }, [activeStoreId, appReady]);

  useEffect(() => {
    if (!appReady || !activeStoreId) return;
    const unsub = network.subscribe((state) => {
      if (state.isConnected) {
        void runSyncCycle(activeStoreId);
      }
    });
    return unsub;
  }, [activeStoreId, appReady]);

  useEffect(() => {
    if (!appReady || !activeStoreId) return;
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") {
        void runSyncCycle(activeStoreId);
      }
    });
    return () => sub.remove();
  }, [activeStoreId, appReady]);

  useEffect(() => {
    if (!appReady || !activeStoreId) return;
    void runSyncCycle(activeStoreId);
  }, [activeStoreId, appReady]);
}

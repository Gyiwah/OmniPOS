import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import { useEffect } from "react";
import { AppState, Platform } from "react-native";

import { getOrCreateOfflineEncryptionMaterial } from "@/src/database/encryptionKey";
import { registerBackgroundSync } from "@/src/sync/backgroundSyncRegistration";
import { runSyncCycle } from "@/src/sync/syncEngine";
import { SYNC_STORAGE } from "@/src/sync/keys";
import { refreshPendingSyncCount } from "@/src/sync/syncCounters";
import { useStoreSlice } from "@/src/store/storeSlice";

/**
 * NetInfo + AppState + initial hydration hooks for OmniPOS offline engine.
 */
export function useOfflineSyncOrchestrator(): void {
  const activeStoreId = useStoreSlice((s) => s.activeStoreId);

  useEffect(() => {
    void getOrCreateOfflineEncryptionMaterial();
    void refreshPendingSyncCount();
    void registerBackgroundSync();

    AsyncStorage.getItem(SYNC_STORAGE.activeStoreId).then((stored) => {
      if (!stored) return;
      const current = useStoreSlice.getState().activeStoreId;
      if (!current) {
        useStoreSlice.getState().setActiveStore(stored);
      }
    });
  }, []);

  useEffect(() => {
    if (activeStoreId) {
      void AsyncStorage.setItem(SYNC_STORAGE.activeStoreId, activeStoreId);
    }
  }, [activeStoreId]);

  useEffect(() => {
    if (!activeStoreId) return;
    const unsub = NetInfo.addEventListener((state) => {
      if (state.isConnected) {
        void runSyncCycle(activeStoreId);
      }
    });
    return unsub;
  }, [activeStoreId]);

  useEffect(() => {
    if (!activeStoreId) return;
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") {
        void runSyncCycle(activeStoreId);
      }
    });
    return () => sub.remove();
  }, [activeStoreId]);

  useEffect(() => {
    if (Platform.OS === "web" || !activeStoreId) return;
    void runSyncCycle(activeStoreId);
  }, [activeStoreId]);
}

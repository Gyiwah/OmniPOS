import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { Colors } from "@/src/constants/colors";
import { database } from "@/src/database";
import type SyncQueueItem from "@/src/database/models/SyncQueueItem";
import { useStoreSlice } from "@/src/store/storeSlice";
import { synchronise } from "@/src/sync";

export function SyncStatusHeader() {
  const activeStoreId = useStoreSlice((s) => s.activeStoreId);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (!activeStoreId) return;

    let isMounted = true;
    const updateCount = async () => {
      try {
        const count = await database
          .get<SyncQueueItem>("sync_queue")
          .query()
          .fetchCount();
        if (isMounted) setPendingCount(count);
      } catch {
        // ignore error
      }
    };

    void updateCount();
    const interval = setInterval(updateCount, 10000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [activeStoreId]);

  const handleManualSync = async () => {
    if (!activeStoreId || syncing) return;
    setSyncing(true);
    try {
      await synchronise(activeStoreId);
      const count = await database
        .get<SyncQueueItem>("sync_queue")
        .query()
        .fetchCount();
      setPendingCount(count);
    } catch {
      // ignore sync error
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Pressable
      style={({ pressed }) => [
        styles.badge,
        pendingCount > 0 ? styles.badgePending : styles.badgeSynced,
        pressed && styles.pressed,
      ]}
      onPress={handleManualSync}
    >
      {syncing ? (
        <ActivityIndicator size="small" color={Colors.primaryBlue} />
      ) : pendingCount > 0 ? (
        <Ionicons name="cloud-upload-outline" size={14} color="#b45309" />
      ) : (
        <Ionicons name="checkmark-circle-outline" size={14} color="#15803d" />
      )}

      <Text
        style={[
          styles.text,
          pendingCount > 0 ? styles.textPending : styles.textSynced,
        ]}
      >
        {syncing ? "Syncing..." : pendingCount > 0 ? `${pendingCount} Queued` : "Cloud Synced"}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  badgeSynced: {
    backgroundColor: "#f0fdf4",
    borderColor: "#bbf7d0",
  },
  badgePending: {
    backgroundColor: "#fef3c7",
    borderColor: "#fde68a",
  },
  pressed: {
    opacity: 0.8,
  },
  text: {
    fontSize: 11,
    fontWeight: "700",
  },
  textSynced: {
    color: "#166534",
  },
  textPending: {
    color: "#92400e",
  },
});

import { Redirect } from "expo-router";
import { Pressable, StyleSheet, Text } from "react-native";

import { ScreenPlaceholder } from "@/src/components/molecules/ScreenPlaceholder";
import { Colors } from "@/src/constants/colors";
import { useSync } from "@/src/hooks/useSync";
import { useStoreSlice } from "@/src/store/storeSlice";
import { useSyncStore } from "@/src/store/syncStore";

export default function HomeScreen() {
  const activeStoreId = useStoreSlice((state) => state.activeStoreId);
  const { syncNow } = useSync();
  const syncing = useSyncStore((s) => s.syncing);
  const pending = useSyncStore((s) => s.pendingCount);

  if (!activeStoreId) {
    return <Redirect href="/onboarding/store" />;
  }

  return (
    <ScreenPlaceholder
      title="Home"
      subtitle={`Offline cache + queue. Pending sync: ${pending}. Tap Sync to push/pull now.`}
      right={
        <Pressable onPress={() => void syncNow()} disabled={syncing} style={styles.syncPill}>
          <Text style={styles.syncLabel}>{syncing ? "..." : "Sync"}</Text>
        </Pressable>
      }
    />
  );
}

const styles = StyleSheet.create({
  syncPill: {
    backgroundColor: Colors.primaryBluePale,
    borderRadius: 50,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  syncLabel: {
    color: Colors.primaryBlue,
    fontWeight: "700",
    fontSize: 13,
  },
});

import { DatabaseProvider } from "@nozbe/watermelondb/react";
import { Stack } from "expo-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useMemo } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { database } from "@/src/database";
import { useOfflineSyncOrchestrator } from "@/src/hooks/useOfflineSyncOrchestrator";

function OfflineSyncBootstrap() {
  useOfflineSyncOrchestrator();
  return null;
}

export default function RootLayout() {
  const queryClient = useMemo(() => new QueryClient(), []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <DatabaseProvider database={database}>
          <QueryClientProvider client={queryClient}>
            <OfflineSyncBootstrap />
            <Stack screenOptions={{ headerShown: false }} />
          </QueryClientProvider>
        </DatabaseProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

import { DatabaseProvider } from "@nozbe/watermelondb/react";
import { Stack } from "expo-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useMemo, type ReactNode } from "react";
import { ActivityIndicator, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { database } from "@/src/database";
import { useAuthBootstrap } from "@/src/hooks/useAuthBootstrap";
import { useOfflineSyncOrchestrator } from "@/src/hooks/useOfflineSyncOrchestrator";
import { useStoreProfile } from "@/src/hooks/useStoreProfile";
import { useBootstrapStore } from "@/src/store/bootstrapStore";

function AppBootstrap({ children }: { children: ReactNode }) {
  useAuthBootstrap();
  const ready = useBootstrapStore((s) => s.ready);
  useOfflineSyncOrchestrator(ready);

  // The shop's own name, email and tax rates, which until now arrived only if
  // somebody happened to open the Settings screen.
  useStoreProfile();

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return children;
}

export default function RootLayout() {
  const queryClient = useMemo(() => new QueryClient(), []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <DatabaseProvider database={database}>
          <QueryClientProvider client={queryClient}>
            <AppBootstrap>
              <Stack screenOptions={{ headerShown: false }} />
            </AppBootstrap>
          </QueryClientProvider>
        </DatabaseProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
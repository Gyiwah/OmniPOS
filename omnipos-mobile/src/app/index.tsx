import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useAuthStore } from "@/src/store/authStore";
import { useBootstrapStore } from "@/src/store/bootstrapStore";
import { useStoreSlice } from "@/src/store/storeSlice";

export default function IndexScreen() {
  const ready = useBootstrapStore((state) => state.ready);
  const userId = useAuthStore((state) => state.userId);
  const isSuperAdmin = useAuthStore((state) => state.isSuperAdmin);
  const activeStoreId = useStoreSlice((state) => state.activeStoreId);

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!userId) {
    return <Redirect href="/(auth)/sign-in" />;
  }

  if (!activeStoreId) {
    if (isSuperAdmin) {
      return <Redirect href="/super-admin" />;
    }

    return <Redirect href="/onboarding/store" />;
  }

  return <Redirect href="/(tabs)/home" />;
}

import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useAuthStore } from "@/src/store/authStore";
import { useBootstrapStore } from "@/src/store/bootstrapStore";
import { useStoreSlice } from "@/src/store/storeSlice";

export default function IndexScreen() {
  const ready = useBootstrapStore((state) => state.ready);
  const userId = useAuthStore((state) => state.userId);
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
    return <Redirect href="/onboarding/store" />;
  }

  return <Redirect href="/(tabs)/home" />;
}

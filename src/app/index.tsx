import { Redirect } from "expo-router";
import { useAuthStore } from "@/src/store/authStore";
import { useStoreSlice } from "@/src/store/storeSlice";

export default function IndexScreen() {
  const userId = useAuthStore((state) => state.userId);
  const activeStoreId = useStoreSlice((state) => state.activeStoreId);

  if (!userId) {
    return <Redirect href="/(auth)/sign-in" />;
  }

  if (!activeStoreId) {
    return <Redirect href="/onboarding/store" />;
  }

  return <Redirect href="/(tabs)/home" />;
}

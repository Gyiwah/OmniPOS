import { Redirect } from "expo-router";
import { ScreenPlaceholder } from "@/src/components/molecules/ScreenPlaceholder";
import { useStoreSlice } from "@/src/store/storeSlice";

export default function HomeScreen() {
  const activeStoreId = useStoreSlice((state) => state.activeStoreId);
  if (!activeStoreId) {
    return <Redirect href="/onboarding/store" />;
  }

  return <ScreenPlaceholder title="Home" subtitle="Daily snapshot and quick POS actions." />;
}

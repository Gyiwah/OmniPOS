import { useLocalSearchParams } from "expo-router";
import { ScreenPlaceholder } from "@/src/components/molecules/ScreenPlaceholder";

export default function ReceiptScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ScreenPlaceholder title="Receipt" subtitle={`Receipt reference: ${id ?? "unknown"}`} />;
}

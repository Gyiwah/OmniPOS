import { useLocalSearchParams } from "expo-router";
import { ScreenPlaceholder } from "@/src/components/molecules/ScreenPlaceholder";

export default function EditProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ScreenPlaceholder title="Edit Product" subtitle={`Editing product ID: ${id ?? "unknown"}`} />;
}

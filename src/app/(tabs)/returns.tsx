import { useRouter } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

import { AppScrollScreen, SectionCard } from "@/src/components/layout/AppScrollScreen";
import { PrimaryButton } from "@/src/components/atoms/PrimaryButton";
import { ReturnCard } from "@/src/components/molecules/ReturnCard";
import { Spacing } from "@/src/constants/spacing";
import { Typography } from "@/src/constants/typography";
import { Colors } from "@/src/constants/colors";
import { MOCK_RETURNS } from "@/src/lib/uiMock";

export default function ReturnsScreen() {
  const router = useRouter();

  return (
    <AppScrollScreen title="Returns" subtitle="Recent refunds (static).">
      <PrimaryButton label="Process new return" onPress={() => router.push("/pos/add-return")} />

      <SectionCard>
        <Text style={styles.sectionTitle}>History</Text>
        <View style={styles.list}>
          {MOCK_RETURNS.map((r) => (
            <ReturnCard
              key={r.id}
              thumbnail={r.thumbnail}
              dateLabel={r.dateLabel}
              itemCount={r.itemCount}
              totalRefundLabel={r.totalRefundLabel}
              onPress={() => {}}
            />
          ))}
        </View>
      </SectionCard>
    </AppScrollScreen>
  );
}

const styles = StyleSheet.create({
  sectionTitle: {
    ...Typography.title,
    color: Colors.textPrimary,
    marginBottom: Spacing.xs,
  },
  list: {
    gap: Spacing.sm,
  },
});

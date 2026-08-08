import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, StyleSheet, View } from "react-native";

import { PrimaryButton } from "@/src/components/atoms/PrimaryButton";
import { TextInput } from "@/src/components/atoms/TextInput";
import { AppScrollScreen, SectionCard } from "@/src/components/layout/AppScrollScreen";
import { Colors } from "@/src/constants/colors";
import { Spacing } from "@/src/constants/spacing";
import { database } from "@/src/database";
import type Customer from "@/src/database/models/Customer";
import { useStoreSlice } from "@/src/store/storeSlice";
import { enqueueSyncItem } from "@/src/sync/enqueue";

export default function AddCustomerScreen() {
  const router = useRouter();
  const activeStoreId = useStoreSlice((s) => s.activeStoreId);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSave() {
    if (!activeStoreId) {
      Alert.alert("Store missing", "Select an active store before creating customers.");
      return;
    }
    if (!name.trim()) {
      Alert.alert("Name required", "Please enter the customer's name.");
      return;
    }

    setSubmitting(true);
    try {
      const now = Date.now();
      let recordId = "";

      await database.write(async () => {
        const custCol = database.get<Customer>("customers");
        const created = await custCol.create((rec) => {
          rec.storeId = activeStoreId;
          rec.name = name.trim();
          rec.phone = phone.trim() || undefined;
          rec.email = email.trim() || undefined;
          rec.notes = notes.trim() || undefined;
          rec.totalSpend = 0;
          rec.outstandingBalance = 0;
          rec.updatedAt = now;
          rec.dirty = true;
        });
        recordId = created.id;
      });

      await enqueueSyncItem({
        storeId: activeStoreId,
        entity: "customers",
        operation: "upsert",
        payload: {
          id: recordId,
          store_id: activeStoreId,
          name: name.trim(),
          phone: phone.trim() || null,
          email: email.trim() || null,
          notes: notes.trim() || null,
          total_spend: 0,
          outstanding_balance: 0,
        },
        recordId,
      });

      Alert.alert("Customer added", `"${name}" was saved successfully.`);
      router.back();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not create customer";
      Alert.alert("Error", message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppScrollScreen showBack title="New Customer" subtitle="Register customer details for order tracking.">
      <SectionCard style={styles.card}>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Customer Name *"
          leftIcon={<Ionicons name="person-outline" size={18} color={Colors.textMuted} />}
        />
        <TextInput
          value={phone}
          onChangeText={setPhone}
          placeholder="Phone Number"
          keyboardType="phone-pad"
          leftIcon={<Ionicons name="call-outline" size={18} color={Colors.textMuted} />}
        />
        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="Email Address"
          keyboardType="email-address"
          leftIcon={<Ionicons name="mail-outline" size={18} color={Colors.textMuted} />}
        />
        <TextInput
          value={notes}
          onChangeText={setNotes}
          placeholder="Notes (optional)"
          leftIcon={<Ionicons name="document-text-outline" size={18} color={Colors.textMuted} />}
        />
      </SectionCard>

      <PrimaryButton
        label={submitting ? "Saving..." : "Save Customer"}
        loading={submitting}
        disabled={submitting}
        onPress={() => void handleSave()}
      />
    </AppScrollScreen>
  );
}

const styles = StyleSheet.create({
  card: { gap: Spacing.sm },
});

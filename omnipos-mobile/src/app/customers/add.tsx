import Ionicons from "@expo/vector-icons/Ionicons";
import { uuidv7 } from "@/src/core/ids";
import { useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import NetInfo from "@react-native-community/netinfo";

import { TextInput } from "@/src/components/atoms/TextInput";
import { AppScrollScreen, SectionCard } from "@/src/components/layout/AppScrollScreen";
import { Colors } from "@/src/constants/colors";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";
import { Typography } from "@/src/constants/typography";
import { database } from "@/src/database";
import type Customer from "@/src/database/models/Customer";
import { useStoreSlice } from "@/src/store/storeSlice";
import { enqueueChange } from "@/src/sync/enqueue";
import { synchronise } from "@/src/sync";
import { supabase } from "@/src/services/supabase";
import { usingLaravel } from "@/src/core/api/config";

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
      Alert.alert("Store Missing", "Select an active store before creating customers.");
      return;
    }
    if (!name.trim()) {
      Alert.alert("Name Required", "Please enter the customer's full name.");
      return;
    }

    setSubmitting(true);
    try {
      const now = Date.now();
      const customerId = uuidv7();

      await database.write(async () => {
        const custCol = database.get<Customer>("customers");
        await custCol.create((rec) => {
          rec._raw.id = customerId;
          rec.storeId = activeStoreId;
          rec.remoteId = customerId;
          rec.name = name.trim();
          rec.phone = phone.trim() || undefined;
          rec.email = email.trim() || undefined;
          rec.notes = notes.trim() || undefined;
          rec.totalSpend = 0;
          rec.outstandingBalance = 0;
          rec.updatedAt = now;
          rec.dirty = true;
        });
      });

      /*
       * Optimistic direct write, Supabase only.
       *
       * Under Laravel the queued operation below is the single path to the
       * server. Writing here as well would put the same customer into two
       * backends, and whichever the app later reads from would look right while
       * the other silently drifted.
       */
      let syncedDirectly = false;
      const net = await NetInfo.fetch();
      if (!usingLaravel && net.isConnected) {
        try {
          const { error: insertErr } = await supabase.from("customers").upsert(
            {
              id: customerId,
              store_id: activeStoreId,
              name: name.trim(),
              phone: phone.trim() || null,
              email: email.trim() || null,
              notes: notes.trim() || null,
              total_spend: 0,
              outstanding_balance: 0,
            },
            { onConflict: "id" }
          );

          if (!insertErr) {
            syncedDirectly = true;
            try {
              const localRec = await database.get<Customer>("customers").find(customerId);
              await database.write(async () => {
                await localRec.update((r) => {
                  r.dirty = false;
                });
              });
            } catch {
              // ignore
            }
          }
        } catch {
          // fallback to queue
        }
      }

      if (!syncedDirectly) {
        await enqueueChange({
          storeId: activeStoreId,
          entity: "customers",
          operation: "upsert",
          recordId: customerId,
          payload: {
            id: customerId,
            store_id: activeStoreId,
            name: name.trim(),
            phone: phone.trim() || null,
            email: email.trim() || null,
            notes: notes.trim() || null,
            total_spend: 0,
            outstanding_balance: 0,
          },
        });
        void synchronise(activeStoreId);
      }

      Alert.alert("Customer Registered", `"${name.trim()}" was successfully added to your store database.`);
      router.back();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not create customer profile";
      Alert.alert("Registration Error", message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppScrollScreen
      showBack
      title="Register Customer"
      subtitle="Add customer contact info to assign orders and track sales."
    >
      {/* Identity Card */}
      <SectionCard>
        <View style={styles.cardHeader}>
          <Ionicons name="person-circle-outline" size={20} color={Colors.primaryBlue} />
          <Text style={styles.sectionTitle}>Personal Details</Text>
        </View>

        <TextInput
          label="Full Name *"
          value={name}
          onChangeText={setName}
          placeholder="e.g. Ama Serwaa"
          leftIcon={<Ionicons name="person-outline" size={18} color={Colors.textMuted} />}
        />

        <TextInput
          label="Phone Number"
          value={phone}
          onChangeText={setPhone}
          placeholder="e.g. 0244123456"
          keyboardType="phone-pad"
          leftIcon={<Ionicons name="call-outline" size={18} color={Colors.textMuted} />}
        />

        <TextInput
          label="Email Address"
          value={email}
          onChangeText={setEmail}
          placeholder="client@email.com"
          autoCapitalize="none"
          keyboardType="email-address"
          leftIcon={<Ionicons name="mail-outline" size={18} color={Colors.textMuted} />}
        />
      </SectionCard>

      {/* Notes / Preferences Card */}
      <SectionCard>
        <View style={styles.cardHeader}>
          <Ionicons name="clipboard-outline" size={20} color={Colors.primaryBlue} />
          <Text style={styles.sectionTitle}>Notes & Special Instructions</Text>
        </View>

        <TextInput
          label="Customer Notes"
          value={notes}
          onChangeText={setNotes}
          placeholder="e.g. Prefers WhatsApp invoices or weekend deliveries..."
          multiline
          numberOfLines={3}
          leftIcon={<Ionicons name="document-text-outline" size={18} color={Colors.textMuted} />}
        />
      </SectionCard>

      {/* Save Action */}
      <View style={styles.submitContainer}>
        <Pressable
          style={({ pressed }) => [
            styles.saveButton,
            submitting && styles.saveButtonDisabled,
            pressed && styles.saveButtonPressed,
          ]}
          disabled={submitting}
          onPress={() => void handleSave()}
        >
          {submitting ? (
            <ActivityIndicator size="small" color={Colors.white} />
          ) : (
            <Ionicons name="checkmark-circle-outline" size={20} color={Colors.white} />
          )}
          <Text style={styles.saveButtonText}>
            {submitting ? "Saving Profile..." : "Save Customer Profile"}
          </Text>
        </Pressable>
      </View>
    </AppScrollScreen>
  );
}

const styles = StyleSheet.create({
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: Spacing.sm,
  },
  sectionTitle: {
    ...Typography.title,
    fontSize: 16,
    color: Colors.textPrimary,
  },
  submitContainer: {
    marginTop: Spacing.xs,
    marginBottom: Spacing.xl,
  },
  saveButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: Colors.primaryBlue,
    paddingVertical: 16,
    borderRadius: Radius.pill,
    shadowColor: Colors.primaryBlue,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  saveButtonPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.99 }],
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    color: Colors.white,
    fontSize: 16,
    fontWeight: "800",
  },
});

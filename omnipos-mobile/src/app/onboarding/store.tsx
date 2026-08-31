import { useEffect, useState } from "react";
import { router } from "expo-router";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Colors } from "@/src/constants/colors";
import { storesService } from "@/src/features/stores/service";
import { useAuthStore } from "@/src/store/authStore";
import { useStoreSlice } from "@/src/store/storeSlice";
import { toErrorMessage } from "@/src/utils/errors";

export default function StoreOnboardingScreen() {
  const userId = useAuthStore((state) => state.userId);
  const activeStoreId = useStoreSlice((state) => state.activeStoreId);
  const setActiveStore = useStoreSlice((state) => state.setActiveStore);

  const [storeName, setStoreName] = useState("");
  const [taxProfile, setTaxProfile] = useState("standard");
  const [currency, setCurrency] = useState("USD");
  const [timezone, setTimezone] = useState("UTC");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadStores() {
      if (!userId) {
        router.replace("/(auth)/sign-in");
        return;
      }

      try {
        const stores = await storesService.list();
        if (stores.length === 0) {
          setError("No store membership found. Sign in again to bootstrap your first store.");
          return;
        }

        const selected = activeStoreId ? stores.find((s) => s.id === activeStoreId) ?? stores[0] : stores[0];
        setActiveStore(selected.id);
        setStoreName(selected.name);
        setTaxProfile(selected.taxProfile);
        setCurrency(selected.currency);
        setTimezone(selected.timezone);
      } catch (err) {
        setError(toErrorMessage(err, "Failed to load store."));
      }
    }

    loadStores();
  }, [activeStoreId, setActiveStore, userId]);

  async function onComplete() {
    if (!activeStoreId) {
      setError("Select or create a store first.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      await storesService.upsertActiveStoreProfile({
        activeStoreId,
        name: storeName.trim() || "My Store",
        taxProfile: taxProfile.trim() || "standard",
        currency: currency.trim().toUpperCase() || "USD",
        timezone: timezone.trim() || "UTC",
      });
      router.replace("/(tabs)/home");
    } catch (err) {
      setError(toErrorMessage(err, "Unable to save onboarding details."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.card}>
        <Text style={styles.title}>Store Onboarding</Text>
        <Text style={styles.subtitle}>Set store profile to activate OmniPOS home access.</Text>

        <TextInput placeholder="Store name" style={styles.input} value={storeName} onChangeText={setStoreName} />
        <TextInput placeholder="Tax profile" style={styles.input} value={taxProfile} onChangeText={setTaxProfile} />
        <TextInput
          placeholder="Currency (e.g. USD)"
          autoCapitalize="characters"
          style={styles.input}
          value={currency}
          onChangeText={setCurrency}
        />
        <TextInput
          placeholder="Timezone (e.g. UTC, Africa/Nairobi)"
          style={styles.input}
          value={timezone}
          onChangeText={setTimezone}
        />

        {!!error && <Text style={styles.error}>{error}</Text>}

        <Pressable style={styles.button} disabled={loading} onPress={onComplete}>
          <Text style={styles.buttonText}>{loading ? "Saving..." : "Complete Onboarding"}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background, padding: 16, justifyContent: "center" },
  card: {
    backgroundColor: Colors.white,
    borderRadius: 20,
    padding: 20,
    gap: 10,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  title: { fontSize: 24, fontWeight: "700", color: Colors.secondary },
  subtitle: { color: Colors.mutedText, marginBottom: 8 },
  input: {
    backgroundColor: Colors.background,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  button: { backgroundColor: Colors.primary, borderRadius: 50, paddingVertical: 12, marginTop: 8 },
  buttonText: { color: Colors.white, textAlign: "center", fontWeight: "700" },
  error: { color: Colors.accent, fontSize: 13 },
});

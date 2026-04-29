import { useState } from "react";
import { Link, router } from "expo-router";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Colors } from "@/src/constants/colors";
import { authService } from "@/src/features/auth/service";
import { useAuthStore } from "@/src/store/authStore";
import { useStoreSlice } from "@/src/store/storeSlice";
import { toErrorMessage } from "@/src/utils/errors";

export default function SignUpScreen() {
  const setSession = useAuthStore((state) => state.setSession);
  const setActiveStore = useStoreSlice((state) => state.setActiveStore);
  const [fullName, setFullName] = useState("");
  const [storeName, setStoreName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function onSignUp() {
    setLoading(true);
    setError("");
    try {
      const result = await authService.signUp({
        fullName: fullName.trim(),
        storeName: storeName.trim() || "My Store",
        email: email.trim(),
        password,
      });

      if (result.session?.user) {
        setSession(result.session.user.id, "admin");
        setActiveStore("storeId" in result ? result.storeId : null);
        router.replace("/onboarding/store");
        return;
      }

      router.replace("/(auth)/sign-in");
    } catch (err) {
      setError(toErrorMessage(err, "Sign up failed."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.card}>
        <Text style={styles.title}>Create Store Account</Text>
        <Text style={styles.subtitle}>Your account becomes the first store admin automatically.</Text>

        <TextInput placeholder="Full name" style={styles.input} value={fullName} onChangeText={setFullName} />
        <TextInput placeholder="Store name" style={styles.input} value={storeName} onChangeText={setStoreName} />
        <TextInput
          placeholder="Email"
          autoCapitalize="none"
          keyboardType="email-address"
          style={styles.input}
          value={email}
          onChangeText={setEmail}
        />
        <TextInput
          placeholder="Password"
          secureTextEntry
          style={styles.input}
          value={password}
          onChangeText={setPassword}
        />

        {!!error && <Text style={styles.error}>{error}</Text>}

        <Pressable style={styles.button} disabled={loading} onPress={onSignUp}>
          <Text style={styles.buttonText}>{loading ? "Creating..." : "Create Account"}</Text>
        </Pressable>

        <Link href="/(auth)/sign-in" style={styles.link}>
          Already have an account? Sign in.
        </Link>
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
  link: { color: Colors.primary, marginTop: 8, textAlign: "center" },
  error: { color: Colors.accent, fontSize: 13 },
});

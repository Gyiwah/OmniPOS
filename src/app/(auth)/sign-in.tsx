import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Link, router } from "expo-router";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { TextInput } from "@/src/components/atoms/TextInput";
import { Colors } from "@/src/constants/colors";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";
import { Typography } from "@/src/constants/typography";
import { authService } from "@/src/features/auth/service";
import { useAuthStore } from "@/src/store/authStore";
import { useStoreSlice } from "@/src/store/storeSlice";
import { toErrorMessage } from "@/src/utils/errors";

export default function SignInScreen() {
  const setSession = useAuthStore((state) => state.setSession);
  const setActiveStore = useStoreSlice((state) => state.setActiveStore);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function onSignIn() {
    if (!email.trim() || !password) {
      setError("Please enter both email and password.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const session = await authService.signIn({ email: email.trim(), password });
      setSession(session.userId, session.role);
      setActiveStore(session.storeId);
      router.replace("/(tabs)/home");
    } catch (err) {
      setError(toErrorMessage(err, "Invalid email or password."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.container}>
        {/* Branding Hero */}
        <View style={styles.brandHero}>
          <View style={styles.logoWrap}>
            <Ionicons name="storefront" size={32} color={Colors.white} />
          </View>
          <Text style={styles.brandTitle}>OmniPOS</Text>
          <Text style={styles.brandSubtitle}>Intelligent Cloud & Offline Point of Sale</Text>
        </View>

        {/* Login Form Card */}
        <View style={styles.card}>
          <Text style={styles.formTitle}>Sign In</Text>
          <Text style={styles.formSub}>Enter your cashier or store admin credentials.</Text>

          <View style={styles.inputsWrapper}>
            <TextInput
              label="Email Address"
              placeholder="e.g. admin@store.com"
              autoCapitalize="none"
              keyboardType="email-address"
              value={email}
              onChangeText={(v) => {
                setEmail(v);
                setError("");
              }}
              leftIcon={<Ionicons name="mail-outline" size={18} color={Colors.textMuted} />}
            />

            <TextInput
              label="Password"
              placeholder="••••••••"
              secureTextEntry={!showPassword}
              value={password}
              onChangeText={(v) => {
                setPassword(v);
                setError("");
              }}
              leftIcon={<Ionicons name="lock-closed-outline" size={18} color={Colors.textMuted} />}
              rightIcon={
                <Pressable onPress={() => setShowPassword((v) => !v)} hitSlop={10}>
                  <Ionicons
                    name={showPassword ? "eye-off-outline" : "eye-outline"}
                    size={20}
                    color={Colors.textMuted}
                  />
                </Pressable>
              }
            />
          </View>

          {!!error && (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={16} color={Colors.danger} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <Pressable
            style={({ pressed }) => [
              styles.submitBtn,
              loading && { opacity: 0.7 },
              pressed && styles.submitBtnPressed,
            ]}
            disabled={loading}
            onPress={onSignIn}
          >
            {loading ? (
              <ActivityIndicator size="small" color={Colors.white} />
            ) : (
              <Ionicons name="log-in-outline" size={20} color={Colors.white} />
            )}
            <Text style={styles.submitBtnText}>{loading ? "Authenticating..." : "Sign In to Store"}</Text>
          </Pressable>

          <View style={styles.footerLinkWrap}>
            <Text style={styles.footerText}>New to OmniPOS?</Text>
            <Link href="/(auth)/sign-up" style={styles.linkText}>
              Register New Store
            </Link>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#0f172a",
    justifyContent: "center",
  },
  container: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.lg,
  },
  brandHero: {
    alignItems: "center",
    gap: Spacing.xs,
  },
  logoWrap: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: Colors.primaryBlue,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: Colors.primaryBlue,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 6,
  },
  brandTitle: {
    fontSize: 28,
    fontWeight: "900",
    color: Colors.white,
    letterSpacing: -0.5,
  },
  brandSubtitle: {
    fontSize: 13,
    color: "#94a3b8",
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    padding: Spacing.lg,
    gap: Spacing.sm,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 5,
  },
  formTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: Colors.textPrimary,
  },
  formSub: {
    fontSize: 13,
    color: Colors.textMuted,
    marginTop: -4,
    marginBottom: 4,
  },
  inputsWrapper: {
    gap: Spacing.xs,
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#fff1f2",
    borderRadius: Radius.input,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "#fecdd3",
  },
  errorText: {
    color: Colors.danger,
    fontSize: 13,
    fontWeight: "600",
    flex: 1,
  },
  submitBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: Colors.primaryBlue,
    borderRadius: Radius.pill,
    paddingVertical: 15,
    marginTop: Spacing.xs,
    shadowColor: Colors.primaryBlue,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  submitBtnPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.99 }],
  },
  submitBtnText: {
    color: Colors.white,
    fontSize: 15,
    fontWeight: "800",
  },
  footerLinkWrap: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
    marginTop: Spacing.xs,
  },
  footerText: {
    fontSize: 13,
    color: Colors.textMuted,
  },
  linkText: {
    fontSize: 13,
    fontWeight: "800",
    color: Colors.primaryBlue,
  },
});

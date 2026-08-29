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

export default function SignUpScreen() {
  const setSession = useAuthStore((state) => state.setSession);
  const setActiveStore = useStoreSlice((state) => state.setActiveStore);
  const [fullName, setFullName] = useState("");
  const [storeName, setStoreName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function onSignUp() {
    if (!fullName.trim() || !email.trim() || !password) {
      setError("Please fill in your name, email, and password.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const result = await authService.signUp({
        fullName: fullName.trim(),
        storeName: storeName.trim() || "My Store",
        email: email.trim(),
        password,
      });

      if (result.session?.user && "storeId" in result && result.storeId) {
        const role =
          "role" in result && (result.role === "admin" || result.role === "manager" || result.role === "cashier")
            ? result.role
            : "admin";
        setSession(result.session.user.id, role);
        setActiveStore(result.storeId);
        router.replace(role === "admin" ? "/onboarding/store" : "/(tabs)/home");
        return;
      }

      router.replace("/(auth)/sign-in");
    } catch (err) {
      setError(toErrorMessage(err, "Sign up failed. Please try again."));
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
            <Ionicons name="storefront" size={28} color={Colors.white} />
          </View>
          <Text style={styles.brandTitle}>OmniPOS</Text>
          <Text style={styles.brandSubtitle}>Create your store and start selling</Text>
        </View>

        {/* Sign Up Card */}
        <View style={styles.card}>
          <Text style={styles.formTitle}>Register Store</Text>
          <Text style={styles.formSub}>Your account automatically becomes the Store Admin.</Text>

          <View style={styles.inputsWrapper}>
            <TextInput
              label="Full Name *"
              placeholder="e.g. Kwame Mensah"
              value={fullName}
              onChangeText={(v) => {
                setFullName(v);
                setError("");
              }}
              leftIcon={<Ionicons name="person-outline" size={18} color={Colors.textMuted} />}
            />

            <TextInput
              label="Store / Business Name *"
              placeholder="e.g. Osu Supermart"
              value={storeName}
              onChangeText={(v) => {
                setStoreName(v);
                setError("");
              }}
              leftIcon={<Ionicons name="business-outline" size={18} color={Colors.textMuted} />}
            />

            <TextInput
              label="Admin Email Address *"
              placeholder="admin@store.com"
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
              label="Create Password *"
              placeholder="At least 6 characters"
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
            onPress={onSignUp}
          >
            {loading ? (
              <ActivityIndicator size="small" color={Colors.white} />
            ) : (
              <Ionicons name="checkmark-circle-outline" size={20} color={Colors.white} />
            )}
            <Text style={styles.submitBtnText}>{loading ? "Creating Store..." : "Create Account & Store"}</Text>
          </Pressable>

          <View style={styles.footerLinkWrap}>
            <Text style={styles.footerText}>Already have an account?</Text>
            <Link href="/(auth)/sign-in" style={styles.linkText}>
              Sign In
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
    gap: Spacing.md,
  },
  brandHero: {
    alignItems: "center",
    gap: 4,
  },
  logoWrap: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: Colors.primaryBlue,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: Colors.primaryBlue,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  brandTitle: {
    fontSize: 24,
    fontWeight: "900",
    color: Colors.white,
    marginTop: 4,
  },
  brandSubtitle: {
    fontSize: 12,
    color: "#94a3b8",
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    padding: Spacing.lg,
    gap: Spacing.xs,
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
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: -2,
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

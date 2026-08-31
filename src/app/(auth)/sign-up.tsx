import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Link, router } from "expo-router";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { TextInput } from "@/src/components/atoms/TextInput";
import { Colors } from "@/src/constants/colors";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";
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
      setError("Please fill in your full name, email, and password.");
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
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.keyboardView}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Top Brand Header */}
          <View style={styles.headerSection}>
            <View style={styles.logoContainer}>
              <Image
                source={require("@/assets/logo.png")}
                style={styles.logoImage}
                resizeMode="contain"
              />
            </View>
            <Text style={styles.brandName}>OmniPOS</Text>
            <Text style={styles.headline}>Register Store</Text>
            <Text style={styles.subtitle}>Create your business account and administrator profile</Text>
          </View>

          {/* Registration Form Card */}
          <View style={styles.formContainer}>
            {!!error && (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle-outline" size={18} color={Colors.danger} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <View style={styles.inputsWrapper}>
              <TextInput
                label="Full Name *"
                placeholder="e.g. Kwame Mensah"
                value={fullName}
                onChangeText={(v) => {
                  setFullName(v);
                  if (error) setError("");
                }}
                leftIcon={<Ionicons name="person-outline" size={18} color={Colors.textMuted} />}
              />

              <TextInput
                label="Store / Business Name *"
                placeholder="e.g. Osu Supermart"
                value={storeName}
                onChangeText={(v) => {
                  setStoreName(v);
                  if (error) setError("");
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
                  if (error) setError("");
                }}
                leftIcon={<Ionicons name="mail-outline" size={18} color={Colors.textMuted} />}
              />

              <TextInput
                label="Master Password *"
                placeholder="At least 6 characters"
                secureTextEntry={!showPassword}
                value={password}
                onChangeText={(v) => {
                  setPassword(v);
                  if (error) setError("");
                }}
                leftIcon={<Ionicons name="lock-closed-outline" size={18} color={Colors.textMuted} />}
                rightIcon={
                  <Pressable onPress={() => setShowPassword((v) => !v)} hitSlop={12}>
                    <Ionicons
                      name={showPassword ? "eye-off-outline" : "eye-outline"}
                      size={20}
                      color={Colors.textMuted}
                    />
                  </Pressable>
                }
              />
            </View>

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
                <Text style={styles.submitBtnText}>Create Store Account</Text>
              )}
            </Pressable>

            {/* Bottom Sign In Link */}
            <View style={styles.footerWrap}>
              <Text style={styles.footerText}>Already have an account?</Text>
              <Link href="/(auth)/sign-in" style={styles.linkText}>
                Sign In
              </Link>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.xxl,
  },
  headerSection: {
    alignItems: "center",
    marginBottom: Spacing.xl,
  },
  logoContainer: {
    width: 64,
    height: 64,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.sm,
    shadowColor: Colors.navy,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  logoImage: {
    width: 42,
    height: 42,
  },
  brandName: {
    fontSize: 14,
    fontWeight: "700",
    color: Colors.primaryBlue,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  headline: {
    fontSize: 26,
    fontWeight: "800",
    color: Colors.textPrimary,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginTop: 4,
    textAlign: "center",
  },
  formContainer: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: Colors.navy,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 16,
    elevation: 2,
    gap: Spacing.lg,
  },
  inputsWrapper: {
    gap: Spacing.md,
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#fef2f2",
    padding: Spacing.md,
    borderRadius: Radius.input,
    borderWidth: 1,
    borderColor: "#fecaca",
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "500",
    color: Colors.danger,
  },
  submitBtn: {
    backgroundColor: Colors.primaryBlue,
    paddingVertical: 15,
    borderRadius: Radius.pill,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: Colors.primaryBlue,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 3,
  },
  submitBtnPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.99 }],
  },
  submitBtnText: {
    color: Colors.white,
    fontSize: 16,
    fontWeight: "700",
  },
  footerWrap: {
    flexDirection: "column",
    alignItems: "center",
    gap: 4,
    paddingTop: Spacing.xs,
  },
  footerText: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  linkText: {
    fontSize: 14,
    color: Colors.primaryBlue,
    fontWeight: "700",
  },
});

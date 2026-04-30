import { router } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text } from "react-native";

import { PrimaryButton } from "@/src/components/atoms/PrimaryButton";
import { TextInput } from "@/src/components/atoms/TextInput";
import { AppScrollScreen, SectionCard } from "@/src/components/layout/AppScrollScreen";
import { Colors } from "@/src/constants/colors";
import { Spacing } from "@/src/constants/spacing";
import { Typography } from "@/src/constants/typography";

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState("");

  return (
    <AppScrollScreen showBack title="Forgot Password" subtitle="Request a reset code by email.">
      <SectionCard>
        <Text style={styles.helper}>
          Enter your account email and we will send a one-time code to continue password reset.
        </Text>
        <TextInput
          label="Email address"
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          autoCapitalize="none"
          keyboardType="email-address"
        />
      </SectionCard>

      <PrimaryButton
        label="Send reset code"
        onPress={() => {
          router.push("/(auth)/otp");
        }}
      />
    </AppScrollScreen>
  );
}

const styles = StyleSheet.create({
  helper: {
    ...Typography.body,
    color: Colors.textSecondary,
    lineHeight: 22,
    marginBottom: Spacing.xs,
  },
});

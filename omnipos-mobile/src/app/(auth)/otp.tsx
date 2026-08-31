import { router } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";

import { PrimaryButton } from "@/src/components/atoms/PrimaryButton";
import { TextInput } from "@/src/components/atoms/TextInput";
import { AppScrollScreen, SectionCard } from "@/src/components/layout/AppScrollScreen";
import { Colors } from "@/src/constants/colors";
import { Spacing } from "@/src/constants/spacing";
import { Typography } from "@/src/constants/typography";

export default function OtpScreen() {
  const [otp, setOtp] = useState("");

  return (
    <AppScrollScreen showBack title="OTP Verification" subtitle="Enter the 6-digit code sent to your email.">
      <SectionCard>
        <TextInput
          label="Verification code"
          value={otp}
          onChangeText={setOtp}
          placeholder="000000"
          keyboardType="number-pad"
          maxLength={6}
        />
        <Pressable onPress={() => {}} style={styles.resendBtn}>
          <Text style={styles.resendText}>Resend code</Text>
        </Pressable>
      </SectionCard>

      <PrimaryButton
        label="Verify code"
        onPress={() => {
          router.replace("/(auth)/sign-in");
        }}
      />
    </AppScrollScreen>
  );
}

const styles = StyleSheet.create({
  resendBtn: {
    alignSelf: "flex-start",
    paddingVertical: Spacing.xs,
  },
  resendText: {
    ...Typography.caption,
    color: Colors.primaryBlue,
    fontWeight: "700",
  },
});

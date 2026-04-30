import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

import { Avatar } from "@/src/components/atoms/Avatar";
import { PrimaryButton } from "@/src/components/atoms/PrimaryButton";
import { TextInput } from "@/src/components/atoms/TextInput";
import { AppScrollScreen, SectionCard } from "@/src/components/layout/AppScrollScreen";
import { Colors } from "@/src/constants/colors";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";
import { Typography } from "@/src/constants/typography";

type Role = "cashier" | "manager" | "owner";
type Invite = { id: string; email: string; role: Role; sentAt: string; status: "pending" | "accepted" };

const STAFF = [
  { id: "u1", name: "Ama Mensah", role: "cashier" as Role, email: "ama@northside.shop" },
  { id: "u2", name: "Kofi Boateng", role: "manager" as Role, email: "kofi@northside.shop" },
];

export default function SettingsUsersScreen() {
  const [inviteEmail, setInviteEmail] = useState("");
  const [role, setRole] = useState<Role>("cashier");
  const [invites, setInvites] = useState<Invite[]>([]);

  function sendInvite() {
    const email = inviteEmail.trim().toLowerCase();
    if (!email || !email.includes("@")) {
      Alert.alert("Invalid email", "Enter a valid email address for the invite.");
      return;
    }
    const invite: Invite = {
      id: `inv-${Date.now()}`,
      email,
      role,
      sentAt: new Date().toLocaleString(),
      status: "pending",
    };
    setInvites((prev) => [invite, ...prev]);
    setInviteEmail("");
  }

  function resendInvite(email: string) {
    Alert.alert("Invite resent", `A fresh invite link was sent to ${email}.`);
  }

  return (
    <AppScrollScreen showBack title="Users" subtitle="Invite staff and manage roles across locations.">
      <SectionCard>
        <Text style={styles.sectionTitle}>Team members</Text>
        <View style={styles.list}>
          {STAFF.map((member) => (
            <View key={member.id} style={styles.row}>
              <View style={styles.left}>
                <Avatar fallbackInitials={member.name} />
                <View>
                  <Text style={styles.name}>{member.name}</Text>
                  <Text style={styles.meta}>{member.email}</Text>
                </View>
              </View>
              <Text style={styles.role}>{member.role}</Text>
            </View>
          ))}
        </View>
      </SectionCard>

      <SectionCard>
        <Text style={styles.sectionTitle}>Multi-user invite</Text>
        <TextInput
          label="Email address"
          value={inviteEmail}
          onChangeText={setInviteEmail}
          placeholder="staff@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
        />
        <View style={styles.roleRow}>
          {(["cashier", "manager", "owner"] as Role[]).map((option) => (
            <Pressable
              key={option}
              onPress={() => setRole(option)}
              style={[styles.rolePill, role === option && styles.rolePillActive]}
            >
              <Text style={[styles.roleText, role === option && styles.roleTextActive]}>{option}</Text>
            </Pressable>
          ))}
        </View>
        <PrimaryButton label="Send invite" onPress={sendInvite} />
      </SectionCard>

      <SectionCard>
        <Text style={styles.sectionTitle}>Pending invites</Text>
        <View style={styles.list}>
          {invites.map((invite) => (
            <View key={invite.id} style={styles.inviteRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{invite.email}</Text>
                <Text style={styles.meta}>
                  {invite.role.toUpperCase()} · {invite.sentAt} · {invite.status}
                </Text>
              </View>
              <PrimaryButton
                label="Resend"
                variant="outline"
                fullWidth={false}
                style={styles.resendBtn}
                onPress={() => resendInvite(invite.email)}
              />
            </View>
          ))}
          {invites.length === 0 ? <Text style={styles.empty}>No invites yet.</Text> : null}
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
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.input,
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  inviteRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.input,
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  left: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  name: {
    ...Typography.body,
    color: Colors.textPrimary,
    fontWeight: "700",
  },
  meta: {
    ...Typography.caption,
    color: Colors.textMuted,
    marginTop: 2,
  },
  role: {
    ...Typography.caption,
    color: Colors.primaryBlue,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  roleRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.xs,
  },
  rolePill: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
  },
  rolePillActive: {
    borderColor: Colors.primaryBlue,
    backgroundColor: Colors.primaryBluePale,
  },
  roleText: {
    color: Colors.textSecondary,
    fontWeight: "600",
  },
  roleTextActive: {
    color: Colors.primaryBlue,
  },
  resendBtn: {
    minWidth: 86,
  },
  empty: {
    color: Colors.textMuted,
    textAlign: "center",
  },
});

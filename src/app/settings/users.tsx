import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";

import { Avatar } from "@/src/components/atoms/Avatar";
import { PrimaryButton } from "@/src/components/atoms/PrimaryButton";
import { TextInput } from "@/src/components/atoms/TextInput";
import { AppScrollScreen, SectionCard } from "@/src/components/layout/AppScrollScreen";
import { Colors } from "@/src/constants/colors";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";
import { Typography } from "@/src/constants/typography";
import { usePendingInvites, useRevokeInvite, useSendInvite, useStoreTeamMembers } from "@/src/features/settings/hooks";
import type { InviteRole } from "@/src/features/settings/types";
import { toErrorMessage } from "@/src/utils/errors";

export default function SettingsUsersScreen() {
  const { data: members = [], isLoading, isError, error } = useStoreTeamMembers();
  const { data: invites = [], isLoading: invitesLoading } = usePendingInvites();
  const sendInvite = useSendInvite();
  const revokeInvite = useRevokeInvite();

  const [inviteEmail, setInviteEmail] = useState("");
  const [role, setRole] = useState<InviteRole>("cashier");

  async function onSendInvite(resend = false, emailOverride?: string) {
    const email = (emailOverride ?? inviteEmail).trim().toLowerCase();
    if (!email || !email.includes("@")) {
      Alert.alert("Invalid email", "Enter a valid email address for the invite.");
      return;
    }

    try {
      const result = await sendInvite.mutateAsync({ email, role, resend });
      if (!emailOverride) setInviteEmail("");

      if (result.emailSent) {
        Alert.alert("Invite sent", `An invite email was sent to ${email}.`);
        return;
      }

      Alert.alert(
        "Invite saved",
        result.warning ??
          `${email} was added as a pending invite. They can sign in (or create an account) with this email to join.`,
      );
    } catch (err) {
      Alert.alert("Invite failed", toErrorMessage(err, "Could not send invite."));
    }
  }

  function onRevoke(inviteId: string, email: string) {
    Alert.alert("Revoke invite?", `Remove the pending invite for ${email}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Revoke",
        style: "destructive",
        onPress: () => {
          void revokeInvite.mutateAsync(inviteId).catch((err) => {
            Alert.alert("Revoke failed", toErrorMessage(err, "Could not revoke invite."));
          });
        },
      },
    ]);
  }

  return (
    <AppScrollScreen showBack title="Users" subtitle="Invite staff and manage roles across locations.">
      <SectionCard>
        <Text style={styles.sectionTitle}>Team members</Text>
        {isLoading ? <ActivityIndicator color={Colors.primaryBlue} /> : null}
        {isError ? <Text style={styles.error}>{toErrorMessage(error, "Failed to load team members.")}</Text> : null}
        <View style={styles.list}>
          {members.map((member) => (
            <View key={member.userId} style={styles.row}>
              <View style={styles.left}>
                <Avatar uri={member.avatarUrl} fallbackInitials={member.fullName} />
                <View>
                  <Text style={styles.name}>{member.fullName}</Text>
                  <Text style={styles.meta}>
                    Joined {member.joinedAt ? new Date(member.joinedAt).toLocaleDateString() : "—"}
                  </Text>
                </View>
              </View>
              <Text style={styles.role}>{member.role}</Text>
            </View>
          ))}
          {!isLoading && members.length === 0 ? <Text style={styles.empty}>No team members found.</Text> : null}
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
          {(["cashier", "manager", "admin"] as InviteRole[]).map((option) => (
            <Pressable
              key={option}
              onPress={() => setRole(option)}
              style={[styles.rolePill, role === option && styles.rolePillActive]}
            >
              <Text style={[styles.roleText, role === option && styles.roleTextActive]}>{option}</Text>
            </Pressable>
          ))}
        </View>
        <PrimaryButton
          label={sendInvite.isPending ? "Sending…" : "Send invite"}
          disabled={sendInvite.isPending}
          onPress={() => void onSendInvite(false)}
        />
      </SectionCard>

      <SectionCard>
        <Text style={styles.sectionTitle}>Pending invites</Text>
        {invitesLoading ? <ActivityIndicator color={Colors.primaryBlue} /> : null}
        <View style={styles.list}>
          {invites.map((invite) => (
            <View key={invite.id} style={styles.inviteRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{invite.email}</Text>
                <Text style={styles.meta}>
                  {invite.role.toUpperCase()} ·{" "}
                  {invite.sentAt ? new Date(invite.sentAt).toLocaleString() : "—"}
                  {invite.expiresAt ? ` · expires ${new Date(invite.expiresAt).toLocaleDateString()}` : ""}
                </Text>
              </View>
              <View style={styles.inviteActions}>
                <PrimaryButton
                  label="Resend"
                  variant="outline"
                  fullWidth={false}
                  style={styles.actionBtn}
                  disabled={sendInvite.isPending}
                  onPress={() => void onSendInvite(true, invite.email)}
                />
                <PrimaryButton
                  label="Revoke"
                  variant="outline"
                  fullWidth={false}
                  style={styles.actionBtn}
                  disabled={revokeInvite.isPending}
                  onPress={() => onRevoke(invite.id, invite.email)}
                />
              </View>
            </View>
          ))}
          {!invitesLoading && invites.length === 0 ? <Text style={styles.empty}>No invites yet.</Text> : null}
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
    gap: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.input,
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  inviteActions: {
    flexDirection: "row",
    gap: Spacing.xs,
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
  actionBtn: {
    minWidth: 78,
  },
  empty: {
    color: Colors.textMuted,
    textAlign: "center",
  },
  error: {
    ...Typography.body,
    color: Colors.accentOrange,
    marginBottom: Spacing.xs,
  },
});

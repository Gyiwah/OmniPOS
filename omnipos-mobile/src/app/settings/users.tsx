import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";

import { Avatar } from "@/src/components/atoms/Avatar";
import { TextInput } from "@/src/components/atoms/TextInput";
import { AppScrollScreen, SectionCard } from "@/src/components/layout/AppScrollScreen";
import { Colors } from "@/src/constants/colors";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";
import { Typography } from "@/src/constants/typography";
import { useAddUser, usePendingInvites, useRevokeInvite, useSendInvite, useStoreTeamMembers } from "@/src/features/settings/hooks";
import type { InviteRole } from "@/src/features/settings/types";
import { useAuthStore } from "@/src/store/authStore";
import { toErrorMessage } from "@/src/utils/errors";

const ROLE_CONFIG: Record<InviteRole, { label: string; desc: string; icon: keyof typeof Ionicons.glyphMap; color: string; bg: string }> = {
  cashier: { label: "Cashier", desc: "Process sales, receipts, and returns", icon: "cart-outline", color: "#2563eb", bg: "#eff6ff" },
  manager: { label: "Manager", desc: "Manage catalog, batches, and sales", icon: "shield-outline", color: "#059669", bg: "#ecfdf5" },
  admin: { label: "Store Admin", desc: "Full control of store settings & team", icon: "key-outline", color: "#7c3aed", bg: "#f5f3ff" },
};

export default function SettingsUsersScreen() {
  const { data: members = [], isLoading, isError, error } = useStoreTeamMembers();
  const { data: invites = [], isLoading: invitesLoading } = usePendingInvites();
  const sendInvite = useSendInvite();
  const addUser = useAddUser();
  const revokeInvite = useRevokeInvite();
  const currentRole = useAuthStore((state) => state.role);

  const [inviteEmail, setInviteEmail] = useState("");
  const [userName, setUserName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [userPassword, setUserPassword] = useState("");
  const [role, setRole] = useState<InviteRole>("cashier");

  async function onAddUser() {
    const name = userName.trim();
    const email = userEmail.trim().toLowerCase();
    if (!name || !email.includes("@") || userPassword.length < 8) {
      Alert.alert("Incomplete User Details", "Enter a name, valid email, and password of at least 8 characters.");
      return;
    }

    try {
      await addUser.mutateAsync({ name, email, password: userPassword, role });
      setUserName("");
      setUserEmail("");
      setUserPassword("");
      Alert.alert("User Added", `${name} can sign in to the store immediately.`);
    } catch (err) {
      Alert.alert("User Add Failed", toErrorMessage(err, "Could not add user."));
    }
  }

  async function onSendInvite(resend = false, emailOverride?: string) {
    const email = (emailOverride ?? inviteEmail).trim().toLowerCase();
    if (!email || !email.includes("@")) {
      Alert.alert("Invalid Email", "Please enter a valid email address.");
      return;
    }

    try {
      const result = await sendInvite.mutateAsync({ email, role, resend });
      if (!emailOverride) setInviteEmail("");

      if (result.emailSent) {
        Alert.alert("Invitation Sent", `An invite link has been dispatched to ${email}.`);
        return;
      }

      Alert.alert(
        "Invite Registered",
        result.warning ??
          `${email} was added as a pending team member. When they log in with this email, they will join the store automatically.`,
      );
    } catch (err) {
      Alert.alert("Invite Failed", toErrorMessage(err, "Could not send invite."));
    }
  }

  function onRevoke(inviteId: string, email: string) {
    Alert.alert("Revoke Invitation?", `Are you sure you want to cancel the invite for ${email}?`, [
      { text: "Keep Invite", style: "cancel" },
      {
        text: "Revoke",
        style: "destructive",
        onPress: () => {
          void revokeInvite.mutateAsync(inviteId).catch((err) => {
            Alert.alert("Revoke Failed", toErrorMessage(err, "Could not revoke invitation."));
          });
        },
      },
    ]);
  }

  return (
    <AppScrollScreen
      showBack
      title="Team & Access"
      subtitle="Invite cashiers, managers, and store administrators."
    >
      {/* Active Team Members Card */}
      <SectionCard>
        <View style={styles.cardHeader}>
          <Ionicons name="people-outline" size={20} color={Colors.primaryBlue} />
          <Text style={styles.sectionTitle}>Active Team ({members.length})</Text>
        </View>

        {isLoading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="small" color={Colors.primaryBlue} />
            <Text style={styles.loadingText}>Loading team profiles...</Text>
          </View>
        ) : null}

        {isError ? <Text style={styles.error}>{toErrorMessage(error, "Failed to load team.")}</Text> : null}

        <View style={styles.membersList}>
          {members.map((member) => {
            const roleConfig = ROLE_CONFIG[member.role as InviteRole] ?? ROLE_CONFIG.cashier;
            return (
              <View key={member.userId} style={styles.memberCard}>
                <View style={styles.memberLeft}>
                  <Avatar uri={member.avatarUrl} fallbackInitials={member.fullName} size={44} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.memberName}>{member.fullName}</Text>
                    <Text style={styles.memberJoined}>
                      Active · Joined {member.joinedAt ? new Date(member.joinedAt).toLocaleDateString([], { month: "short", year: "numeric" }) : "Recently"}
                    </Text>
                  </View>
                </View>

                <View style={[styles.roleBadge, { backgroundColor: roleConfig.bg }]}>
                  <Text style={[styles.roleBadgeText, { color: roleConfig.color }]}>
                    {roleConfig.label}
                  </Text>
                </View>
              </View>
            );
          })}

          {!isLoading && members.length === 0 ? (
            <Text style={styles.emptyNotice}>No team members found for this store.</Text>
          ) : null}
        </View>
      </SectionCard>

      {currentRole === "admin" ? (
        <SectionCard>
          <View style={styles.cardHeader}>
            <Ionicons name="person-add-outline" size={20} color={Colors.primaryBlue} />
            <Text style={styles.sectionTitle}>Add User Directly</Text>
          </View>

          <TextInput
            label="Full Name"
            value={userName}
            onChangeText={setUserName}
            placeholder="e.g. Alex Johnson"
            leftIcon={<Ionicons name="person-outline" size={18} color={Colors.textMuted} />}
          />
          <TextInput
            label="Email Address"
            value={userEmail}
            onChangeText={setUserEmail}
            placeholder="e.g. alex@store.com"
            keyboardType="email-address"
            autoCapitalize="none"
            leftIcon={<Ionicons name="mail-outline" size={18} color={Colors.textMuted} />}
          />
          <TextInput
            label="Temporary Password"
            value={userPassword}
            onChangeText={setUserPassword}
            placeholder="At least 8 characters"
            secureTextEntry
            leftIcon={<Ionicons name="lock-closed-outline" size={18} color={Colors.textMuted} />}
          />

          <Text style={styles.roleHeaderLabel}>Assign Store Role</Text>
          <View style={styles.roleGrid}>
            {(["cashier", "manager", "admin"] as InviteRole[]).map((r) => {
              const cfg = ROLE_CONFIG[r];
              const active = role === r;
              return (
                <Pressable
                  key={r}
                  style={({ pressed }) => [styles.roleCard, active && styles.roleCardActive, pressed && { opacity: 0.8 }]}
                  onPress={() => setRole(r)}
                >
                  <View style={[styles.roleIconWrap, active && { backgroundColor: Colors.primaryBlue }]}>
                    <Ionicons name={cfg.icon} size={18} color={active ? Colors.white : Colors.primaryBlue} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.roleTitle, active && styles.roleTitleActive]}>{cfg.label}</Text>
                    <Text style={styles.roleDesc}>{cfg.desc}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>

          <Pressable
            style={({ pressed }) => [styles.sendInviteBtn, addUser.isPending && { opacity: 0.6 }, pressed && { opacity: 0.9 }]}
            disabled={addUser.isPending}
            onPress={() => void onAddUser()}
          >
            {addUser.isPending ? (
              <ActivityIndicator size="small" color={Colors.white} />
            ) : (
              <Ionicons name="person-add-outline" size={18} color={Colors.white} />
            )}
            <Text style={styles.sendInviteText}>{addUser.isPending ? "Adding User..." : "Add User"}</Text>
          </Pressable>
        </SectionCard>
      ) : null}

      {/* Send Invite Form Card */}
      <SectionCard>
        <View style={styles.cardHeader}>
          <Ionicons name="mail-unread-outline" size={20} color={Colors.primaryBlue} />
          <Text style={styles.sectionTitle}>Invite Staff Member</Text>
        </View>

        <TextInput
          label="Staff Email Address"
          value={inviteEmail}
          onChangeText={setInviteEmail}
          placeholder="e.g. cashier@store.com"
          keyboardType="email-address"
          autoCapitalize="none"
          leftIcon={<Ionicons name="mail-outline" size={18} color={Colors.textMuted} />}
        />

        {/* Role Selector Grid */}
        <Text style={styles.roleHeaderLabel}>Assign Store Role</Text>
        <View style={styles.roleGrid}>
          {(["cashier", "manager", "admin"] as InviteRole[]).map((r) => {
            const cfg = ROLE_CONFIG[r];
            const active = role === r;
            return (
              <Pressable
                key={r}
                style={({ pressed }) => [
                  styles.roleCard,
                  active && styles.roleCardActive,
                  pressed && { opacity: 0.8 },
                ]}
                onPress={() => setRole(r)}
              >
                <View style={[styles.roleIconWrap, active && { backgroundColor: Colors.primaryBlue }]}>
                  <Ionicons name={cfg.icon} size={18} color={active ? Colors.white : Colors.primaryBlue} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.roleTitle, active && styles.roleTitleActive]}>{cfg.label}</Text>
                  <Text style={styles.roleDesc}>{cfg.desc}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        <Pressable
          style={({ pressed }) => [
            styles.sendInviteBtn,
            sendInvite.isPending && { opacity: 0.6 },
            pressed && { opacity: 0.9 },
          ]}
          disabled={sendInvite.isPending}
          onPress={() => void onSendInvite(false)}
        >
          {sendInvite.isPending ? (
            <ActivityIndicator size="small" color={Colors.white} />
          ) : (
            <Ionicons name="paper-plane-outline" size={18} color={Colors.white} />
          )}
          <Text style={styles.sendInviteText}>
            {sendInvite.isPending ? "Sending Invitation..." : "Send Staff Invite"}
          </Text>
        </Pressable>
      </SectionCard>

      {/* Pending Invites Card */}
      <SectionCard>
        <View style={styles.cardHeader}>
          <Ionicons name="time-outline" size={20} color={Colors.accentOrange} />
          <Text style={styles.sectionTitle}>Pending Invitations ({invites.length})</Text>
        </View>

        {invitesLoading ? (
          <ActivityIndicator size="small" color={Colors.primaryBlue} />
        ) : null}

        <View style={styles.invitesList}>
          {invites.map((inv) => (
            <View key={inv.id} style={styles.inviteCard}>
              <View style={styles.inviteInfo}>
                <Text style={styles.inviteEmail}>{inv.email}</Text>
                <Text style={styles.inviteMeta}>
                  Role: {inv.role.toUpperCase()} · Sent {inv.sentAt ? new Date(inv.sentAt).toLocaleDateString() : "Recently"}
                </Text>
              </View>

              <View style={styles.inviteActionsRow}>
                <Pressable
                  style={styles.resendBtn}
                  disabled={sendInvite.isPending}
                  onPress={() => void onSendInvite(true, inv.email)}
                >
                  <Text style={styles.resendText}>Resend</Text>
                </Pressable>
                <Pressable
                  style={styles.revokeBtn}
                  disabled={revokeInvite.isPending}
                  onPress={() => onRevoke(inv.id, inv.email)}
                >
                  <Text style={styles.revokeText}>Revoke</Text>
                </Pressable>
              </View>
            </View>
          ))}

          {!invitesLoading && invites.length === 0 ? (
            <Text style={styles.emptyNotice}>No pending staff invitations.</Text>
          ) : null}
        </View>
      </SectionCard>
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
  loadingBox: {
    paddingVertical: Spacing.md,
    alignItems: "center",
    gap: 6,
  },
  loadingText: {
    fontSize: 13,
    color: Colors.textMuted,
  },
  error: {
    color: Colors.danger,
    fontSize: 13,
    marginBottom: Spacing.xs,
  },
  membersList: {
    gap: Spacing.xs,
  },
  memberCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: Radius.input,
    padding: Spacing.sm,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  memberLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    flex: 1,
  },
  memberName: {
    fontSize: 14,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  memberJoined: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 1,
  },
  roleBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Radius.pill,
  },
  roleBadgeText: {
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  roleHeaderLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: Colors.textSecondary,
    marginTop: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  roleGrid: {
    gap: Spacing.xs,
  },
  roleCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: Radius.input,
    padding: Spacing.sm,
    borderWidth: 1.5,
    borderColor: "#e2e8f0",
    gap: Spacing.sm,
  },
  roleCardActive: {
    borderColor: Colors.primaryBlue,
    backgroundColor: Colors.primaryBluePale,
  },
  roleIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.primaryBluePale,
    alignItems: "center",
    justifyContent: "center",
  },
  roleTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  roleTitleActive: {
    color: Colors.primaryBlue,
    fontWeight: "800",
  },
  roleDesc: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 1,
  },
  sendInviteBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: Colors.primaryBlue,
    borderRadius: Radius.pill,
    paddingVertical: 14,
    marginTop: Spacing.md,
  },
  sendInviteText: {
    color: Colors.white,
    fontSize: 15,
    fontWeight: "800",
  },
  invitesList: {
    gap: Spacing.xs,
  },
  inviteCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: Radius.input,
    padding: Spacing.sm,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  inviteInfo: {
    flex: 1,
    gap: 2,
  },
  inviteEmail: {
    fontSize: 13,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  inviteMeta: {
    fontSize: 11,
    color: Colors.textMuted,
  },
  inviteActionsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  resendBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: Colors.primaryBluePale,
  },
  resendText: {
    fontSize: 11,
    fontWeight: "700",
    color: Colors.primaryBlue,
  },
  revokeBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: "#fff1f2",
  },
  revokeText: {
    fontSize: 11,
    fontWeight: "700",
    color: Colors.danger,
  },
  emptyNotice: {
    textAlign: "center",
    color: Colors.textMuted,
    paddingVertical: Spacing.sm,
  },
});

import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import * as Linking from "expo-linking";

import { supabase } from "@/src/services/supabase";
import { Colors } from "@/src/constants/colors";
import { Typography } from "@/src/constants/typography";
import { Spacing } from "@/src/constants/spacing";
import { useAuthStore } from "@/src/store/authStore";
import { useStoreSlice } from "@/src/store/storeSlice";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SYNC_STORAGE } from "@/src/sync/keys";
import { usingLaravel } from "@/src/core/api/config";

export default function AuthCallbackScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    async function handleAuthCallback() {
      /*
       * This screen exists for Supabase's magic-link and invite deep links.
       *
       * Laravel has no equivalent: invites are attached to the account by the
       * server on sign-in, so there is no token to exchange here and nothing to
       * wait for. Landing on it means a stale link was followed — send the
       * person to sign in rather than showing a spinner that never resolves.
       */
      if (usingLaravel) {
        router.replace("/(auth)/sign-in");
        return;
      }

      try {
        // Parse current deep link URL if needed
        const url = await Linking.getInitialURL();
        if (url) {
          const { queryParams } = Linking.parse(url);
          const access_token = (queryParams?.access_token as string) || (params.access_token as string);
          const refresh_token = (queryParams?.refresh_token as string) || (params.refresh_token as string);

          if (access_token && refresh_token) {
            const { error: sessionError } = await supabase.auth.setSession({
              access_token,
              refresh_token,
            });
            if (sessionError) throw sessionError;
          }
        }

        const { data: userData, error: userError } = await supabase.auth.getUser();
        if (userError || !userData.user) {
          throw userError ?? new Error("Could not verify session.");
        }

        const userId = userData.user.id;

        // Auto-accept any pending invites for this user's email
        const { data: acceptedInvites, error: inviteError } = await supabase.rpc("accept_pending_store_invites");
        if (inviteError && __DEV__) {
          console.warn("[OmniPOS] Error accepting invites:", inviteError.message);
        }

        // Fetch memberships
        const { data: memberships } = await supabase
          .from("store_members")
          .select("store_id, role")
          .eq("user_id", userId);

        const membership = memberships?.[0];
        const storeId = (acceptedInvites && acceptedInvites[0]?.store_id) || membership?.store_id;

        if (membership || acceptedInvites?.length) {
          useAuthStore.getState().setSession(userId, membership?.role ?? "cashier");
        } else {
          useAuthStore.getState().setSession(userId, null);
        }

        if (storeId) {
          useStoreSlice.getState().setActiveStore(storeId);
          await AsyncStorage.setItem(SYNC_STORAGE.activeStoreId, storeId);
        }

        // Navigate to home
        router.replace("/(tabs)/home");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Authentication callback failed.";
        setErrorMsg(msg);
      }
    }

    void handleAuthCallback();
  }, [params, router]);

  return (
    <View style={styles.container}>
      {errorMsg ? (
        <View style={styles.content}>
          <Text style={styles.errorTitle}>Invite Callback Error</Text>
          <Text style={styles.errorMsg}>{errorMsg}</Text>
        </View>
      ) : (
        <View style={styles.content}>
          <ActivityIndicator size="large" color={Colors.primaryBlue} />
          <Text style={styles.loadingText}>Accepting invitation & signing in…</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing.lg,
  },
  content: {
    alignItems: "center",
    gap: Spacing.md,
  },
  loadingText: {
    ...Typography.body,
    color: Colors.textSecondary,
    fontWeight: "600",
  },
  errorTitle: {
    ...Typography.title,
    color: Colors.accentOrange,
  },
  errorMsg: {
    ...Typography.body,
    color: Colors.textMuted,
    textAlign: "center",
  },
});

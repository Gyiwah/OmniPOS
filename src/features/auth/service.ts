import AsyncStorage from "@react-native-async-storage/async-storage";

import { settingsService } from "@/src/features/settings/service";
import { supabase } from "@/src/services/supabase";
import { SYNC_STORAGE } from "@/src/sync/keys";

type SignUpInput = {
  email: string;
  password: string;
  fullName: string;
  storeName: string;
};

type SignInInput = {
  email: string;
  password: string;
};

type Membership = {
  store_id: string;
  role: "admin" | "manager" | "cashier";
};

async function acceptPendingInvitesQuietly(): Promise<{ storeId: string; role: string }[]> {
  try {
    return await settingsService.acceptPendingInvites();
  } catch {
    // Invite table/RPC may not be migrated yet — sign-in should still work.
    return [];
  }
}

async function ensureMembershipAndBootstrap(options?: { storeName?: string; allowBootstrap?: boolean }) {
  const storeName = options?.storeName ?? "My Store";
  const allowBootstrap = options?.allowBootstrap ?? false;

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    throw new Error("Unable to load authenticated user.");
  }

  const userId = userData.user.id;

  const accepted = await acceptPendingInvitesQuietly();

  const { data: memberships, error: membershipError } = await supabase
    .from("store_members")
    .select("store_id, role")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (membershipError) {
    throw membershipError;
  }

  if (memberships && memberships.length > 0) {
    const preferred =
      (accepted[0]
        ? memberships.find((m: Membership) => m.store_id === accepted[0].storeId)
        : null) ?? memberships[0];
    return preferred as Membership;
  }

  if (!allowBootstrap) {
    throw new Error(
      "No store membership found for this account. Ask an admin to invite you, or complete first-store setup from Sign Up.",
    );
  }

  const { data: createdStore, error: storeError } = await supabase
    .from("stores")
    .insert({ name: storeName, owner_user_id: userId })
    .select("id")
    .maybeSingle();

  if (storeError || !createdStore) {
    throw storeError ?? new Error("Store creation failed.");
  }

  const { error: memberInsertError } = await supabase.from("store_members").upsert({
    store_id: createdStore.id,
    user_id: userId,
    role: "admin",
  });

  if (memberInsertError) {
    throw memberInsertError;
  }

  return { store_id: createdStore.id, role: "admin" as const };
}

export const authService = {
  async signUp(input: SignUpInput) {
    const { data, error } = await supabase.auth.signUp({
      email: input.email,
      password: input.password,
      options: {
        data: {
          full_name: input.fullName,
        },
      },
    });

    if (error) {
      throw error;
    }

    if (data.session) {
      const accepted = await acceptPendingInvitesQuietly();
      const membership = await ensureMembershipAndBootstrap({
        storeName: input.storeName,
        // Invited users join their store; only first-time owners bootstrap a new one.
        allowBootstrap: accepted.length === 0,
      });

      await AsyncStorage.setItem(SYNC_STORAGE.activeStoreId, membership.store_id);

      return {
        ...data,
        storeId: membership.store_id,
        role: membership.role,
      };
    }

    return data;
  },

  async signIn(input: SignInInput) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: input.email,
      password: input.password,
    });

    if (error) {
      throw error;
    }

    const membership = await ensureMembershipAndBootstrap({ allowBootstrap: true });
    await AsyncStorage.setItem(SYNC_STORAGE.activeStoreId, membership.store_id);

    return {
      userId: data.user.id,
      storeId: membership.store_id,
      role: membership.role as "admin" | "manager" | "cashier",
    };
  },

  async debugSignIn(input: SignInInput) {
    try {
      const result = await this.signIn(input);
      return { ok: true as const, result };
    } catch (error) {
      return { ok: false as const, error };
    }
  },

  async signOut() {
    await supabase.auth.signOut();
  },
};

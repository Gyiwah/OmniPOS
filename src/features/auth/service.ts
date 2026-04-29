import { supabase } from "@/src/services/supabase";

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

async function ensureMembershipAndBootstrap(options?: { storeName?: string; allowBootstrap?: boolean }) {
  const storeName = options?.storeName ?? "My Store";
  const allowBootstrap = options?.allowBootstrap ?? false;

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    throw new Error("Unable to load authenticated user.");
  }

  const userId = userData.user.id;

  const { data: memberships, error: membershipError } = await supabase
    .from("store_members")
    .select("store_id, role")
    .eq("user_id", userId)
    .limit(1);

  if (membershipError) {
    throw membershipError;
  }

  if (memberships && memberships.length > 0) {
    return memberships[0];
  }

  if (!allowBootstrap) {
    throw new Error(
      "No store membership found for this account. Ask an admin to add you to a store, or complete first-store setup from Sign Up."
    );
  }

  const { data: createdStore, error: storeError } = await supabase
    .from("stores")
    .insert({ name: storeName, owner_user_id: userId })
    .select("id")
    .single();

  if (storeError || !createdStore) {
    throw storeError ?? new Error("Store creation failed.");
  }

  const { error: memberInsertError } = await supabase.from("store_members").insert({
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
      const membership = await ensureMembershipAndBootstrap({
        storeName: input.storeName,
        allowBootstrap: true,
      });
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

    const membership = await ensureMembershipAndBootstrap({ allowBootstrap: false });
    return {
      userId: data.user.id,
      storeId: membership.store_id,
      role: membership.role,
    };
  },

  async debugSignIn(input: SignInInput) {
    try {
      const result = await this.signIn(input);
      return { ok: true as const, result };
    } catch (error) {
      // Keep raw payload for UI debugging; do not swallow details.
      return { ok: false as const, error };
    }
  },

  async signOut() {
    await supabase.auth.signOut();
  },
};

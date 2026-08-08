import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type RequestBody = {
  storeName?: string;
  currency?: string;
  timezone?: string;
  taxProfile?: string;
  adminFullName?: string;
  adminEmail?: string;
  adminPassword?: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return json({ error: "Server misconfigured" }, 500);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Missing authorization" }, 401);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();

    if (userError || !user) {
      return json({ error: "Unauthorized" }, 401);
    }

    // Verify user is super admin
    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("is_super_admin")
      .eq("id", user.id)
      .single();

    if (profileError || !profile?.is_super_admin) {
      return json({ error: "Only Super Admins can provision stores and store admins." }, 403);
    }

    const body = (await req.json()) as RequestBody;
    const storeName = body.storeName?.trim();
    const adminEmail = body.adminEmail?.trim().toLowerCase();
    const adminPassword = body.adminPassword;
    const adminFullName = body.adminFullName?.trim() ?? "";
    const currency = body.currency?.trim() || "USD";
    const timezone = body.timezone?.trim() || "UTC";
    const taxProfile = body.taxProfile?.trim() || "standard";

    if (!storeName) {
      return json({ error: "storeName is required" }, 400);
    }
    if (!adminEmail || !adminEmail.includes("@")) {
      return json({ error: "Valid adminEmail is required" }, 400);
    }
    if (!adminPassword || adminPassword.length < 6) {
      return json({ error: "adminPassword must be at least 6 characters" }, 400);
    }

    // 1. Create or fetch Auth user for Store Admin
    let adminUserId: string | null = null;
    const { data: newAuth, error: createAuthError } = await adminClient.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
      user_metadata: { full_name: adminFullName },
    });

    if (createAuthError) {
      // If user exists, look up user ID
      const { data: listData } = await adminClient.auth.admin.listUsers();
      const existingUser = listData.users.find((u) => u.email?.toLowerCase() === adminEmail);

      if (existingUser) {
        adminUserId = existingUser.id;
        // Update password & metadata
        await adminClient.auth.admin.updateUserById(adminUserId, {
          password: adminPassword,
          user_metadata: { full_name: adminFullName },
        });
      } else {
        return json({ error: createAuthError.message }, 400);
      }
    } else {
      adminUserId = newAuth.user.id;
    }

    // Ensure profile row exists
    await adminClient.from("profiles").upsert(
      {
        id: adminUserId,
        full_name: adminFullName,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );

    // 2. Insert new store
    const { data: createdStore, error: storeError } = await adminClient
      .from("stores")
      .insert({
        name: storeName,
        currency,
        timezone,
        tax_profile: taxProfile,
        owner_user_id: adminUserId,
      })
      .select("id, name, currency, timezone, tax_profile, owner_user_id, created_at")
      .single();

    if (storeError || !createdStore) {
      return json({ error: storeError?.message ?? "Failed to create store" }, 400);
    }

    // 3. Link store admin in store_members
    const { error: memberError } = await adminClient.from("store_members").upsert(
      {
        store_id: createdStore.id,
        user_id: adminUserId,
        role: "admin",
      },
      { onConflict: "store_id,user_id" },
    );

    if (memberError) {
      return json({ error: memberError.message }, 400);
    }

    return json({
      store: createdStore,
      storeAdmin: {
        id: adminUserId,
        email: adminEmail,
        fullName: adminFullName,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected provisioning error";
    return json({ error: message }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type InviteBody = {
  storeId?: string;
  email?: string;
  role?: "admin" | "manager" | "cashier";
  resend?: boolean;
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

    const body = (await req.json()) as InviteBody;
    const storeId = body.storeId?.trim();
    const email = body.email?.trim().toLowerCase();
    const role = body.role ?? "cashier";
    const resend = Boolean(body.resend);

    if (!storeId || !email || !email.includes("@")) {
      return json({ error: "storeId and a valid email are required" }, 400);
    }
    if (!["admin", "manager", "cashier"].includes(role)) {
      return json({ error: "Invalid role" }, 400);
    }

    const { data: membership, error: membershipError } = await userClient
      .from("store_members")
      .select("role")
      .eq("store_id", storeId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (membershipError) {
      return json({ error: membershipError.message }, 400);
    }
    if (!membership || !["admin", "manager"].includes(membership.role)) {
      return json({ error: "Only store admins or managers can invite staff" }, 403);
    }

    const { data: store, error: storeError } = await userClient
      .from("stores")
      .select("id, name")
      .eq("id", storeId)
      .single();

    if (storeError || !store) {
      return json({ error: "Store not found" }, 404);
    }

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 14);

    const { data: invite, error: inviteError } = await adminClient
      .from("store_invites")
      .upsert(
        {
          store_id: storeId,
          email,
          role,
          status: "pending",
          invited_by: user.id,
          accepted_user_id: null,
          expires_at: expiresAt.toISOString(),
        },
        { onConflict: "store_id,email" },
      )
      .select("id, store_id, email, role, status, created_at, expires_at")
      .single();

    if (inviteError || !invite) {
      return json({ error: inviteError?.message ?? "Failed to save invite" }, 400);
    }

    const redirectTo = body.redirectTo?.trim() || Deno.env.get("INVITE_REDIRECT_URL") || "omnipos://auth/callback";
    const { data: invited, error: inviteAuthError } = await adminClient.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: {
        invited_store_id: storeId,
        invited_role: role,
        store_name: store.name,
        full_name: "",
      },
    });

    // If the user already exists, inviteUserByEmail may fail — still keep the invite row.
    if (inviteAuthError) {
      const message = inviteAuthError.message ?? "Invite email failed";
      const alreadyRegistered =
        /already|registered|exists/i.test(message) || inviteAuthError.status === 422;

      if (!alreadyRegistered && !resend) {
        return json(
          {
            error: message,
            invite,
            emailSent: false,
          },
          400,
        );
      }

      // Existing users: they can sign in and accept_pending_store_invites will attach them.
      return json({
        invite,
        emailSent: false,
        warning: alreadyRegistered
          ? "User already has an account. Ask them to sign in to accept the invite."
          : message,
      });
    }

    return json({
      invite,
      emailSent: true,
      userId: invited.user?.id ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected invite error";
    return json({ error: message }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

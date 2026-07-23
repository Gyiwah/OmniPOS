# Supabase Setup (OmniPOS)

## 1) Environment Variables

Copy `.env.example` to `.env` and set:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`

Never commit real secrets. `.env` is ignored by git.

## 2) Run Schema + Security SQL

In Supabase SQL Editor, run:

- `supabase/sql/001_omnipos_init.sql`
- `supabase/sql/002_seed.sql` (optional initial store + admin seed)
- `supabase/sql/003_store_profile_fields.sql` (onboarding metadata fields)

This provisions:

- tables: `profiles`, `stores`, `store_members`, `products`, `orders`, `returns`, `sync_log`
- profile bootstrap trigger on `auth.users`
- RLS on all app tables
- role-aware multi-store policies
- storage bucket + object policies
- realtime table publication

## 3) Staff invites

1. Run `supabase/sql/008_store_invites.sql` in the SQL Editor.
2. Deploy the Edge Function:

```bash
supabase functions deploy invite-store-member
```

Optional function secrets:

- `INVITE_REDIRECT_URL` (default `omnipos://auth/callback`)

Invite flow:

1. Admin/manager sends invite from **Settings → Users**.
2. Function writes `store_invites` and calls Auth `inviteUserByEmail`.
3. Invitee opens the email, sets a password, then signs in.
4. Sign-in/sign-up calls `accept_pending_store_invites()` and attaches them to the store.

## 4) Auth Configuration (Dashboard)

In **Authentication**:

- Enable Email provider
- Configure OTP/email templates as needed (Invite user template)
- Set secure redirect URLs for your app scheme (`omnipos://`)

## 5) Storage

The SQL creates private bucket `omnipos-assets`.
Store object keys with leading store id:

- `<store_uuid>/products/<file>`
- `<store_uuid>/receipts/<file>`

Policies enforce store membership and role checks.

## 6) Realtime

The SQL adds app tables to `supabase_realtime`.
Subscribe client-side with store-scoped filters only.

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

## 3) Auth Configuration (Dashboard)

In **Authentication**:

- Enable Email provider
- Configure OTP/email templates as needed
- Set secure redirect URLs for your app scheme (`omnipos://`)

## 4) Storage

The SQL creates private bucket `omnipos-assets`.
Store object keys with leading store id:

- `<store_uuid>/products/<file>`
- `<store_uuid>/receipts/<file>`

Policies enforce store membership and role checks.

## 5) Realtime

The SQL adds app tables to `supabase_realtime`.
Subscribe client-side with store-scoped filters only.

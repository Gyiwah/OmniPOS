# OmniPOS Supabase SQL Run Order

## Option A (recommended for new projects)

1. `000_omnipos_fresh.sql` - consolidated schema + RLS/policies/storage/realtime
2. `002_seed.sql` - optional seed/bootstrap data (edit placeholders first)

If your target project already has a partial/older `public` schema, `000` is now additive-safe and can still be run.

## Option B (for existing projects with history)

1. `001_omnipos_init.sql` - base schema, RLS, policies, storage policies, realtime publication
2. `003_store_profile_fields.sql` - legacy additive store fields (safe if already in 001)
3. `004_integration_alignment.sql` - aligns schema with current mobile app flow
4. `005_order_items.sql` - order line-item persistence and policies
5. `002_seed.sql` - optional seed/bootstrap data (edit placeholders first)
6. `008_store_invites.sql` - staff invite table, RLS, and accept_pending_store_invites RPC

## Notes

- Scripts are written to be additive and mostly idempotent (`if not exists`, safe trigger recreation).
- Keep RLS enabled; table grants in `004` are only for Data API exposure compatibility.
- `000` is a deployment convenience file for fresh setup; do not run `000` after `001/003/004`.
- If your project already has production data, run first in a staging project and validate.

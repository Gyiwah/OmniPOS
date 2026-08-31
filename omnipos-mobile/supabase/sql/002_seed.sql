-- OmniPOS seed bootstrap
-- Run after 001_omnipos_init.sql.
-- Replace placeholders before running.

-- Option A: set values directly in the WITH input CTE below.
-- Option B: duplicate this script per environment with real values.

with input as (
  select
    'gyiwah.gaf@gmail.com'::text as admin_email,
    'GAF Shop'::text as store_name
),
admin_user as (
  select
    au.id as user_id,
    i.store_name
  from input i
  join auth.users au on lower(au.email) = lower(i.admin_email)
),
created_store as (
  insert into public.stores (name, owner_user_id)
  select store_name, user_id
  from admin_user
  returning id, owner_user_id
)
insert into public.store_members (store_id, user_id, role)
select cs.id, cs.owner_user_id, 'admin'
from created_store cs
on conflict (store_id, user_id) do update
set role = excluded.role;

-- If this inserts 0 rows, the admin email did not match any auth.users record.

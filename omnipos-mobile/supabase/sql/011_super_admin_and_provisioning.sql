-- Migration 011: Super Admin Role & Branch Hierarchy Setup

-- 1. Add is_super_admin column to profiles
alter table public.profiles
  add column if not exists is_super_admin boolean not null default false;

-- 2. Helper function to check if the current user is a super admin
create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.is_super_admin from public.profiles p where p.id = auth.uid()),
    false
  );
$$;

-- 3. Add parent_store_id to stores to allow Store Admins to create sub-branches
alter table public.stores
  add column if not exists parent_store_id uuid references public.stores(id) on delete cascade;

-- 4. Update stores RLS policies to permit Super Admins
drop policy if exists "stores_select_member" on public.stores;
create policy "stores_select_member"
on public.stores for select
using (
  public.is_super_admin()
  or public.is_store_member(id)
  or owner_user_id = auth.uid()
);

drop policy if exists "stores_insert_authenticated" on public.stores;
create policy "stores_insert_authenticated"
on public.stores for insert
with check (
  public.is_super_admin()
  or owner_user_id = auth.uid()
);

drop policy if exists "stores_update_admin" on public.stores;
create policy "stores_update_admin"
on public.stores for update
using (
  public.is_super_admin()
  or public.has_store_role(id, array['admin'])
)
with check (
  public.is_super_admin()
  or public.has_store_role(id, array['admin'])
);

-- 5. Update store_members RLS policies to permit Super Admins
drop policy if exists "store_members_select_member" on public.store_members;
create policy "store_members_select_member"
on public.store_members for select
using (
  public.is_super_admin()
  or public.is_store_member(store_id)
);

drop policy if exists "store_members_insert_admin_manager" on public.store_members;
create policy "store_members_insert_admin_manager"
on public.store_members for insert
with check (
  public.is_super_admin()
  or public.has_store_role(store_id, array['admin', 'manager'])
  or (
    user_id = auth.uid()
    and exists (
      select 1
      from public.stores s
      where s.id = store_members.store_id
        and s.owner_user_id = auth.uid()
    )
  )
);

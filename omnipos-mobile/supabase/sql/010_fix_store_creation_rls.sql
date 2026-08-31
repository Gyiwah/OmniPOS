-- Migration 010: Fix Store Creation RLS & Auto-Membership
-- Enables store owners to immediately query newly created stores during insert/select,
-- and automatically provisions an admin membership row for the store owner.

-- 1. Update is_store_member function to recognize store owners as members
create or replace function public.is_store_member(target_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.store_members sm
    where sm.store_id = target_store_id
      and sm.user_id = auth.uid()
  )
  or exists (
    select 1
    from public.stores s
    where s.id = target_store_id
      and s.owner_user_id = auth.uid()
  );
$$;

-- 2. Ensure stores_select_member policy permits store owners
drop policy if exists "stores_select_member" on public.stores;
create policy "stores_select_member"
on public.stores for select
using (public.is_store_member(id) or owner_user_id = auth.uid());

-- 3. Create trigger to automatically insert store owner as admin in store_members upon store creation
create or replace function public.handle_new_store()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.store_members (store_id, user_id, role)
  values (new.id, new.owner_user_id, 'admin')
  on conflict (store_id, user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_on_store_created on public.stores;
create trigger trg_on_store_created
  after insert on public.stores
  for each row execute function public.handle_new_store();

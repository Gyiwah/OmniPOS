-- OmniPOS multi-shop baseline schema + security
-- Run this in Supabase SQL editor for initial provisioning.

create extension if not exists pgcrypto;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  tax_profile text not null default 'standard',
  currency text not null default 'USD',
  timezone text not null default 'UTC',
  owner_user_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.store_members (
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('admin', 'manager', 'cashier')),
  invited_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (store_id, user_id)
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null,
  sku text not null,
  price numeric(12,2) not null check (price >= 0),
  stock integer not null default 0 check (stock >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, sku)
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  cashier_user_id uuid not null references public.profiles(id) on delete restrict,
  order_number text not null,
  status text not null default 'completed' check (status in ('draft', 'completed', 'voided', 'refunded')),
  subtotal numeric(12,2) not null default 0 check (subtotal >= 0),
  tax numeric(12,2) not null default 0 check (tax >= 0),
  discount numeric(12,2) not null default 0 check (discount >= 0),
  total numeric(12,2) not null default 0 check (total >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, order_number)
);

create table if not exists public.returns (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete restrict,
  processed_by_user_id uuid not null references public.profiles(id) on delete restrict,
  reason text not null default '',
  amount numeric(12,2) not null check (amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sync_log (
  id bigint generated always as identity primary key,
  store_id uuid not null references public.stores(id) on delete cascade,
  table_name text not null,
  record_id uuid not null,
  action text not null check (action in ('insert', 'update', 'delete')),
  payload jsonb not null default '{}'::jsonb,
  synced_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_store_members_user_id on public.store_members(user_id);
create index if not exists idx_products_store_id on public.products(store_id);
create index if not exists idx_orders_store_id on public.orders(store_id);
create index if not exists idx_returns_store_id on public.returns(store_id);
create index if not exists idx_sync_log_store_id on public.sync_log(store_id);

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

create or replace function public.has_store_role(target_store_id uuid, allowed_roles text[])
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
      and sm.role = any(allowed_roles)
  );
$$;

alter table public.profiles enable row level security;
alter table public.stores enable row level security;
alter table public.store_members enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.returns enable row level security;
alter table public.sync_log enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles for select
using (id = auth.uid());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles for update
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists "stores_select_member" on public.stores;
create policy "stores_select_member"
on public.stores for select
using (public.is_store_member(id));

drop policy if exists "stores_insert_authenticated" on public.stores;
create policy "stores_insert_authenticated"
on public.stores for insert
with check (owner_user_id = auth.uid());

drop policy if exists "stores_update_admin" on public.stores;
create policy "stores_update_admin"
on public.stores for update
using (public.has_store_role(id, array['admin']))
with check (public.has_store_role(id, array['admin']));

drop policy if exists "store_members_select_member" on public.store_members;
create policy "store_members_select_member"
on public.store_members for select
using (public.is_store_member(store_id));

drop policy if exists "store_members_insert_admin_manager" on public.store_members;
create policy "store_members_insert_admin_manager"
on public.store_members for insert
with check (
  public.has_store_role(store_id, array['admin', 'manager'])
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

drop policy if exists "store_members_update_admin_manager" on public.store_members;
create policy "store_members_update_admin_manager"
on public.store_members for update
using (public.has_store_role(store_id, array['admin', 'manager']))
with check (public.has_store_role(store_id, array['admin', 'manager']));

drop policy if exists "store_members_delete_admin" on public.store_members;
create policy "store_members_delete_admin"
on public.store_members for delete
using (public.has_store_role(store_id, array['admin']));

drop policy if exists "products_select_member" on public.products;
create policy "products_select_member"
on public.products for select
using (public.is_store_member(store_id));

drop policy if exists "products_write_manager_admin" on public.products;
create policy "products_write_manager_admin"
on public.products for all
using (public.has_store_role(store_id, array['admin', 'manager']))
with check (public.has_store_role(store_id, array['admin', 'manager']));

drop policy if exists "orders_select_member" on public.orders;
create policy "orders_select_member"
on public.orders for select
using (public.is_store_member(store_id));

drop policy if exists "orders_insert_cashier_plus" on public.orders;
create policy "orders_insert_cashier_plus"
on public.orders for insert
with check (public.has_store_role(store_id, array['admin', 'manager', 'cashier']));

drop policy if exists "orders_update_manager_admin" on public.orders;
create policy "orders_update_manager_admin"
on public.orders for update
using (public.has_store_role(store_id, array['admin', 'manager']))
with check (public.has_store_role(store_id, array['admin', 'manager']));

drop policy if exists "returns_select_member" on public.returns;
create policy "returns_select_member"
on public.returns for select
using (public.is_store_member(store_id));

drop policy if exists "returns_insert_cashier_plus" on public.returns;
create policy "returns_insert_cashier_plus"
on public.returns for insert
with check (public.has_store_role(store_id, array['admin', 'manager', 'cashier']));

drop policy if exists "returns_update_manager_admin" on public.returns;
create policy "returns_update_manager_admin"
on public.returns for update
using (public.has_store_role(store_id, array['admin', 'manager']))
with check (public.has_store_role(store_id, array['admin', 'manager']));

drop policy if exists "sync_log_select_member" on public.sync_log;
create policy "sync_log_select_member"
on public.sync_log for select
using (public.is_store_member(store_id));

drop policy if exists "sync_log_write_member" on public.sync_log;
create policy "sync_log_write_member"
on public.sync_log for insert
with check (public.is_store_member(store_id));

-- Storage for store-scoped assets: object path format "<store_id>/..."
insert into storage.buckets (id, name, public)
values ('omnipos-assets', 'omnipos-assets', false)
on conflict (id) do nothing;

drop policy if exists "storage_read_store_member" on storage.objects;
create policy "storage_read_store_member"
on storage.objects for select
using (
  bucket_id = 'omnipos-assets'
  and public.is_store_member((storage.foldername(name))[1]::uuid)
);

drop policy if exists "storage_write_admin_manager" on storage.objects;
create policy "storage_write_admin_manager"
on storage.objects for insert
with check (
  bucket_id = 'omnipos-assets'
  and public.has_store_role((storage.foldername(name))[1]::uuid, array['admin', 'manager'])
);

drop policy if exists "storage_update_admin_manager" on storage.objects;
create policy "storage_update_admin_manager"
on storage.objects for update
using (
  bucket_id = 'omnipos-assets'
  and public.has_store_role((storage.foldername(name))[1]::uuid, array['admin', 'manager'])
)
with check (
  bucket_id = 'omnipos-assets'
  and public.has_store_role((storage.foldername(name))[1]::uuid, array['admin', 'manager'])
);

drop policy if exists "storage_delete_admin_manager" on storage.objects;
create policy "storage_delete_admin_manager"
on storage.objects for delete
using (
  bucket_id = 'omnipos-assets'
  and public.has_store_role((storage.foldername(name))[1]::uuid, array['admin', 'manager'])
);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'stores'
  ) then
    alter publication supabase_realtime add table public.stores;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'store_members'
  ) then
    alter publication supabase_realtime add table public.store_members;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'products'
  ) then
    alter publication supabase_realtime add table public.products;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders'
  ) then
    alter publication supabase_realtime add table public.orders;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'returns'
  ) then
    alter publication supabase_realtime add table public.returns;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sync_log'
  ) then
    alter publication supabase_realtime add table public.sync_log;
  end if;
end $$;

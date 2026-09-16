-- OmniPOS consolidated schema for fresh deployments
-- This file is a superset of 001 + 003 + 004 and is intended for NEW projects.
-- For EXISTING projects, keep using incremental scripts.

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

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
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
  email text,
  logo_url text,
  tax_profile text not null default 'standard',
  currency text not null default 'USD',
  timezone text not null default 'UTC',
  language text not null default 'English',
  app_mode_dark boolean not null default false,
  tax_rate numeric(6,2) not null default 0 check (tax_rate >= 0 and tax_rate <= 100),
  vat_rate numeric(6,2) not null default 0 check (vat_rate >= 0 and vat_rate <= 100),
  service_rate numeric(6,2) not null default 0 check (service_rate >= 0 and service_rate <= 100),
  owner_user_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Ensure compatibility when table already exists from older schema
alter table public.stores
  add column if not exists email text,
  add column if not exists logo_url text,
  add column if not exists tax_profile text not null default 'standard',
  add column if not exists currency text not null default 'USD',
  add column if not exists timezone text not null default 'UTC',
  add column if not exists language text not null default 'English',
  add column if not exists app_mode_dark boolean not null default false,
  add column if not exists tax_rate numeric(6,2) not null default 0 check (tax_rate >= 0 and tax_rate <= 100),
  add column if not exists vat_rate numeric(6,2) not null default 0 check (vat_rate >= 0 and vat_rate <= 100),
  add column if not exists service_rate numeric(6,2) not null default 0 check (service_rate >= 0 and service_rate <= 100);

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
  barcode text,
  price numeric(12,2) not null check (price >= 0),
  cost_price numeric(12,2) check (cost_price is null or cost_price >= 0),
  stock integer not null default 0 check (stock >= 0),
  image_url text,
  tags text[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, sku)
);

-- Ensure compatibility when table already exists from older schema
alter table public.products
  add column if not exists barcode text,
  add column if not exists cost_price numeric(12,2) check (cost_price is null or cost_price >= 0),
  add column if not exists image_url text,
  add column if not exists tags text[] not null default '{}';

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
  tax_rate numeric(6,2) not null default 0 check (tax_rate >= 0 and tax_rate <= 100),
  vat_rate numeric(6,2) not null default 0 check (vat_rate >= 0 and vat_rate <= 100),
  service_rate numeric(6,2) not null default 0 check (service_rate >= 0 and service_rate <= 100),
  discount_mode text not null default 'percentage' check (discount_mode in ('percentage', 'amount')),
  discount_value numeric(12,2) not null default 0 check (discount_value >= 0),
  amount_paid numeric(12,2) not null default 0 check (amount_paid >= 0),
  change_due numeric(12,2) not null default 0 check (change_due >= 0),
  customer_name text,
  customer_phone text,
  shipping_address text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, order_number)
);

-- Ensure compatibility when table already exists from older schema
alter table public.orders
  add column if not exists tax_rate numeric(6,2) not null default 0 check (tax_rate >= 0 and tax_rate <= 100),
  add column if not exists vat_rate numeric(6,2) not null default 0 check (vat_rate >= 0 and vat_rate <= 100),
  add column if not exists service_rate numeric(6,2) not null default 0 check (service_rate >= 0 and service_rate <= 100),
  add column if not exists discount_mode text not null default 'percentage' check (discount_mode in ('percentage', 'amount')),
  add column if not exists discount_value numeric(12,2) not null default 0 check (discount_value >= 0),
  add column if not exists amount_paid numeric(12,2) not null default 0 check (amount_paid >= 0),
  add column if not exists change_due numeric(12,2) not null default 0 check (change_due >= 0),
  add column if not exists customer_name text,
  add column if not exists customer_phone text,
  add column if not exists shipping_address text;

create table if not exists public.returns (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete restrict,
  processed_by_user_id uuid not null references public.profiles(id) on delete restrict,
  reason text not null default '',
  amount numeric(12,2) not null check (amount >= 0),
  -- How the money went back. Only a cash refund comes out of the drawer, so a
  -- return that assumed cash left every non-cash refund reconciling short.
  refund_method text not null default 'cash'
    check (refund_method in ('cash', 'card', 'transfer', 'mobile_money', 'momo', 'store_credit', 'loyalty', 'other')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  sku text,
  barcode text,
  product_name text not null,
  unit_price numeric(12,2) not null check (unit_price >= 0),
  quantity integer not null check (quantity > 0),
  line_total numeric(12,2) not null check (line_total >= 0),
  created_at timestamptz not null default now()
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
create index if not exists idx_products_store_updated_at on public.products(store_id, updated_at desc);
create index if not exists idx_products_store_barcode on public.products(store_id, barcode);
create index if not exists idx_orders_store_id on public.orders(store_id);
create index if not exists idx_orders_store_created_at on public.orders(store_id, created_at desc);
create index if not exists idx_returns_store_id on public.returns(store_id);
create index if not exists idx_order_items_order_id on public.order_items(order_id);
create index if not exists idx_order_items_store_id on public.order_items(store_id);
create index if not exists idx_sync_log_store_id on public.sync_log(store_id);

drop trigger if exists trg_stores_updated_at on public.stores;
create trigger trg_stores_updated_at before update on public.stores for each row execute procedure public.set_updated_at();
drop trigger if exists trg_products_updated_at on public.products;
create trigger trg_products_updated_at before update on public.products for each row execute procedure public.set_updated_at();
drop trigger if exists trg_orders_updated_at on public.orders;
create trigger trg_orders_updated_at before update on public.orders for each row execute procedure public.set_updated_at();
drop trigger if exists trg_returns_updated_at on public.returns;
create trigger trg_returns_updated_at before update on public.returns for each row execute procedure public.set_updated_at();

create or replace function public.is_store_member(target_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.store_members sm
    where sm.store_id = target_store_id and sm.user_id = auth.uid()
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
    select 1 from public.store_members sm
    where sm.store_id = target_store_id and sm.user_id = auth.uid() and sm.role = any(allowed_roles)
  );
$$;

alter table public.profiles enable row level security;
alter table public.stores enable row level security;
alter table public.store_members enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.returns enable row level security;
alter table public.order_items enable row level security;
alter table public.sync_log enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles for select using (id = auth.uid());
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
drop policy if exists "stores_select_member" on public.stores;
create policy "stores_select_member" on public.stores for select using (public.is_store_member(id));
drop policy if exists "stores_insert_authenticated" on public.stores;
create policy "stores_insert_authenticated" on public.stores for insert with check (owner_user_id = auth.uid());
drop policy if exists "stores_update_admin" on public.stores;
create policy "stores_update_admin" on public.stores for update using (public.has_store_role(id, array['admin'])) with check (public.has_store_role(id, array['admin']));
drop policy if exists "store_members_select_member" on public.store_members;
create policy "store_members_select_member" on public.store_members for select using (public.is_store_member(store_id));
drop policy if exists "store_members_insert_admin_manager" on public.store_members;
create policy "store_members_insert_admin_manager" on public.store_members for insert with check (
  public.has_store_role(store_id, array['admin', 'manager'])
  or (
    user_id = auth.uid()
    and exists (select 1 from public.stores s where s.id = store_members.store_id and s.owner_user_id = auth.uid())
  )
);
drop policy if exists "store_members_update_admin_manager" on public.store_members;
create policy "store_members_update_admin_manager" on public.store_members for update using (public.has_store_role(store_id, array['admin', 'manager'])) with check (public.has_store_role(store_id, array['admin', 'manager']));
drop policy if exists "store_members_delete_admin" on public.store_members;
create policy "store_members_delete_admin" on public.store_members for delete using (public.has_store_role(store_id, array['admin']));
drop policy if exists "products_select_member" on public.products;
create policy "products_select_member" on public.products for select using (public.is_store_member(store_id));
drop policy if exists "products_write_manager_admin" on public.products;
create policy "products_write_manager_admin" on public.products for all using (public.has_store_role(store_id, array['admin', 'manager'])) with check (public.has_store_role(store_id, array['admin', 'manager']));
drop policy if exists "orders_select_member" on public.orders;
create policy "orders_select_member" on public.orders for select using (public.is_store_member(store_id));
drop policy if exists "orders_insert_cashier_plus" on public.orders;
create policy "orders_insert_cashier_plus" on public.orders for insert with check (public.has_store_role(store_id, array['admin', 'manager', 'cashier']));
drop policy if exists "orders_update_manager_admin" on public.orders;
create policy "orders_update_manager_admin" on public.orders for update using (public.has_store_role(store_id, array['admin', 'manager'])) with check (public.has_store_role(store_id, array['admin', 'manager']));
drop policy if exists "returns_select_member" on public.returns;
create policy "returns_select_member" on public.returns for select using (public.is_store_member(store_id));
drop policy if exists "returns_insert_cashier_plus" on public.returns;
create policy "returns_insert_cashier_plus" on public.returns for insert with check (public.has_store_role(store_id, array['admin', 'manager', 'cashier']));
drop policy if exists "returns_update_manager_admin" on public.returns;
create policy "returns_update_manager_admin" on public.returns for update using (public.has_store_role(store_id, array['admin', 'manager'])) with check (public.has_store_role(store_id, array['admin', 'manager']));
drop policy if exists "order_items_select_member" on public.order_items;
create policy "order_items_select_member" on public.order_items for select using (public.is_store_member(store_id));
drop policy if exists "order_items_insert_cashier_plus" on public.order_items;
create policy "order_items_insert_cashier_plus" on public.order_items for insert with check (public.has_store_role(store_id, array['admin', 'manager', 'cashier']));
drop policy if exists "order_items_update_manager_admin" on public.order_items;
create policy "order_items_update_manager_admin" on public.order_items for update using (public.has_store_role(store_id, array['admin', 'manager'])) with check (public.has_store_role(store_id, array['admin', 'manager']));
drop policy if exists "order_items_delete_manager_admin" on public.order_items;
create policy "order_items_delete_manager_admin" on public.order_items for delete using (public.has_store_role(store_id, array['admin', 'manager']));
drop policy if exists "sync_log_select_member" on public.sync_log;
create policy "sync_log_select_member" on public.sync_log for select using (public.is_store_member(store_id));
drop policy if exists "sync_log_write_member" on public.sync_log;
create policy "sync_log_write_member" on public.sync_log for insert with check (public.is_store_member(store_id));

insert into storage.buckets (id, name, public)
values ('omnipos-assets', 'omnipos-assets', false)
on conflict (id) do nothing;

drop policy if exists "storage_read_store_member" on storage.objects;
create policy "storage_read_store_member" on storage.objects for select using (
  bucket_id = 'omnipos-assets' and public.is_store_member((storage.foldername(name))[1]::uuid)
);
drop policy if exists "storage_write_admin_manager" on storage.objects;
create policy "storage_write_admin_manager" on storage.objects for insert with check (
  bucket_id = 'omnipos-assets' and public.has_store_role((storage.foldername(name))[1]::uuid, array['admin', 'manager'])
);
drop policy if exists "storage_update_admin_manager" on storage.objects;
create policy "storage_update_admin_manager" on storage.objects for update using (
  bucket_id = 'omnipos-assets' and public.has_store_role((storage.foldername(name))[1]::uuid, array['admin', 'manager'])
) with check (
  bucket_id = 'omnipos-assets' and public.has_store_role((storage.foldername(name))[1]::uuid, array['admin', 'manager'])
);
drop policy if exists "storage_delete_admin_manager" on storage.objects;
create policy "storage_delete_admin_manager" on storage.objects for delete using (
  bucket_id = 'omnipos-assets' and public.has_store_role((storage.foldername(name))[1]::uuid, array['admin', 'manager'])
);

grant usage on schema public to anon, authenticated;
grant select on public.stores, public.store_members, public.products, public.orders, public.returns to authenticated;
grant insert, update, delete on public.products, public.orders, public.returns to authenticated;
grant select on public.order_items to authenticated;
grant insert, update, delete on public.order_items to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'stores') then
    alter publication supabase_realtime add table public.stores;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'store_members') then
    alter publication supabase_realtime add table public.store_members;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'products') then
    alter publication supabase_realtime add table public.products;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders') then
    alter publication supabase_realtime add table public.orders;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'returns') then
    alter publication supabase_realtime add table public.returns;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'order_items') then
    alter publication supabase_realtime add table public.order_items;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sync_log') then
    alter publication supabase_realtime add table public.sync_log;
  end if;
end $$;

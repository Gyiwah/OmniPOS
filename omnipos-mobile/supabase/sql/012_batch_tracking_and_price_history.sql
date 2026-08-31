-- Migration 012: Batch Tracking, Stock Movements & Price History

-- 0. Add expiry_date to products
alter table if exists public.products add column if not exists expiry_date date;

-- 1. Product Batches Table
create table if not exists public.product_batches (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  batch_number text not null,
  quantity numeric(12,2) not null default 0,
  cost_price numeric(12,2),
  expiry_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_product_batches_store_id on public.product_batches(store_id);
create index if not exists idx_product_batches_product_id on public.product_batches(product_id);
create index if not exists idx_product_batches_expiry_date on public.product_batches(store_id, expiry_date);

alter table public.product_batches enable row level security;

drop policy if exists "product_batches_select_member" on public.product_batches;
create policy "product_batches_select_member"
on public.product_batches for select
using (public.is_store_member(store_id));

drop policy if exists "product_batches_write_member" on public.product_batches;
create policy "product_batches_write_member"
on public.product_batches for all
using (public.has_store_role(store_id, array['admin', 'manager', 'cashier']))
with check (public.has_store_role(store_id, array['admin', 'manager', 'cashier']));

-- 2. Stock Movements Table
create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  batch_id uuid references public.product_batches(id) on delete set null,
  type text not null, -- 'STOCK_IN', 'STOCK_OUT', 'SALE', 'RETURN', 'ADJUSTMENT', 'DAMAGE', 'EXPIRED', 'AUDIT'
  quantity numeric(12,2) not null,
  quantity_before numeric(12,2) not null default 0,
  quantity_after numeric(12,2) not null default 0,
  reason text not null,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_stock_movements_store_id on public.stock_movements(store_id);
create index if not exists idx_stock_movements_product_id on public.stock_movements(product_id);
create index if not exists idx_stock_movements_created_at on public.stock_movements(store_id, created_at desc);

alter table public.stock_movements enable row level security;

drop policy if exists "stock_movements_select_member" on public.stock_movements;
create policy "stock_movements_select_member"
on public.stock_movements for select
using (public.is_store_member(store_id));

drop policy if exists "stock_movements_write_member" on public.stock_movements;
create policy "stock_movements_write_member"
on public.stock_movements for all
using (public.has_store_role(store_id, array['admin', 'manager', 'cashier']))
with check (public.has_store_role(store_id, array['admin', 'manager', 'cashier']));

-- 3. Price History Table
create table if not exists public.price_history (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  old_sell_price numeric(12,2) not null default 0,
  new_sell_price numeric(12,2) not null default 0,
  old_cost_price numeric(12,2),
  new_cost_price numeric(12,2),
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists idx_price_history_store_id on public.price_history(store_id);
create index if not exists idx_price_history_product_id on public.price_history(product_id);
create index if not exists idx_price_history_created_at on public.price_history(store_id, created_at desc);

alter table public.price_history enable row level security;

drop policy if exists "price_history_select_member" on public.price_history;
create policy "price_history_select_member"
on public.price_history for select
using (public.is_store_member(store_id));

drop policy if exists "price_history_write_member" on public.price_history;
create policy "price_history_write_member"
on public.price_history for all
using (public.has_store_role(store_id, array['admin', 'manager', 'cashier']))
with check (public.has_store_role(store_id, array['admin', 'manager', 'cashier']));

-- 4. Permissions & Realtime
grant select, insert, update, delete on public.product_batches, public.stock_movements, public.price_history to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'product_batches') then
    alter publication supabase_realtime add table public.product_batches;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'stock_movements') then
    alter publication supabase_realtime add table public.stock_movements;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'price_history') then
    alter publication supabase_realtime add table public.price_history;
  end if;
end;
$$;

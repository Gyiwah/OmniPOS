-- OmniPOS Migration: Customers CRM, Payment Methods & Product Reorder Levels

-- 1. Extend products with reorder_level
alter table public.products
  add column if not exists reorder_level integer not null default 5 check (reorder_level >= 0);

-- 2. Extend orders with payment_method and customer_id
alter table public.orders
  add column if not exists payment_method text not null default 'cash' check (payment_method in ('cash', 'card', 'transfer', 'split')),
  add column if not exists customer_id uuid;

-- 3. Provision customers table
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null,
  phone text,
  email text,
  total_spend numeric(12,2) not null default 0 check (total_spend >= 0),
  outstanding_balance numeric(12,2) not null default 0 check (outstanding_balance >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Foreign key check for orders.customer_id
do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'orders_customer_id_fkey' and table_name = 'orders'
  ) then
    alter table public.orders
      add constraint orders_customer_id_fkey foreign key (customer_id) references public.customers(id) on delete set null;
  end if;
end $$;

-- Indexes
create index if not exists idx_customers_store_id on public.customers(store_id);
create index if not exists idx_customers_phone on public.customers(store_id, phone);
create index if not exists idx_orders_customer_id on public.orders(customer_id);

-- RLS Security
alter table public.customers enable row level security;

drop policy if exists "customers_select_member" on public.customers;
create policy "customers_select_member"
on public.customers for select
using (public.is_store_member(store_id));

drop policy if exists "customers_insert_cashier_plus" on public.customers;
create policy "customers_insert_cashier_plus"
on public.customers for insert
with check (public.has_store_role(store_id, array['admin', 'manager', 'cashier']));

drop policy if exists "customers_update_cashier_plus" on public.customers;
create policy "customers_update_cashier_plus"
on public.customers for update
using (public.has_store_role(store_id, array['admin', 'manager', 'cashier']))
with check (public.has_store_role(store_id, array['admin', 'manager', 'cashier']));

drop policy if exists "customers_delete_admin_manager" on public.customers;
create policy "customers_delete_admin_manager"
on public.customers for delete
using (public.has_store_role(store_id, array['admin', 'manager']));

grant select, insert, update, delete on public.customers to authenticated;

-- Add updated_at trigger to customers
drop trigger if exists trg_customers_updated_at on public.customers;
create trigger trg_customers_updated_at
before update on public.customers
for each row execute procedure public.set_updated_at();

-- Add customers to Supabase Realtime publication
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'customers'
  ) then
    alter publication supabase_realtime add table public.customers;
  end if;
end $$;

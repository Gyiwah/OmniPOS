-- Order line-item persistence for full checkout logic

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

create index if not exists idx_order_items_order_id on public.order_items(order_id);
create index if not exists idx_order_items_store_id on public.order_items(store_id);

alter table public.order_items enable row level security;

drop policy if exists "order_items_select_member" on public.order_items;
create policy "order_items_select_member"
on public.order_items for select
using (public.is_store_member(store_id));

drop policy if exists "order_items_insert_cashier_plus" on public.order_items;
create policy "order_items_insert_cashier_plus"
on public.order_items for insert
with check (public.has_store_role(store_id, array['admin', 'manager', 'cashier']));

drop policy if exists "order_items_update_manager_admin" on public.order_items;
create policy "order_items_update_manager_admin"
on public.order_items for update
using (public.has_store_role(store_id, array['admin', 'manager']))
with check (public.has_store_role(store_id, array['admin', 'manager']));

drop policy if exists "order_items_delete_manager_admin" on public.order_items;
create policy "order_items_delete_manager_admin"
on public.order_items for delete
using (public.has_store_role(store_id, array['admin', 'manager']));

grant select on public.order_items to authenticated;
grant insert, update, delete on public.order_items to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'order_items'
  ) then
    alter publication supabase_realtime add table public.order_items;
  end if;
end $$;

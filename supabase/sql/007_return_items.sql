-- Line-item persistence for product returns

create table if not exists public.return_items (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references public.returns(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  order_item_id uuid not null references public.order_items(id) on delete restrict,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  unit_price numeric(12,2) not null check (unit_price >= 0),
  quantity integer not null check (quantity > 0),
  line_total numeric(12,2) not null check (line_total >= 0),
  created_at timestamptz not null default now()
);

create index if not exists idx_return_items_return_id on public.return_items(return_id);
create index if not exists idx_return_items_store_id on public.return_items(store_id);
create index if not exists idx_return_items_order_item_id on public.return_items(order_item_id);

alter table public.return_items enable row level security;

drop policy if exists "return_items_select_member" on public.return_items;
create policy "return_items_select_member"
on public.return_items for select
using (public.is_store_member(store_id));

drop policy if exists "return_items_insert_cashier_plus" on public.return_items;
create policy "return_items_insert_cashier_plus"
on public.return_items for insert
with check (public.has_store_role(store_id, array['admin', 'manager', 'cashier']));

grant select, insert on public.return_items to authenticated;

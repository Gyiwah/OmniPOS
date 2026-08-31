-- Allow cashiers to manage catalog items (matches POS inventory UX).
-- Run in Supabase SQL editor if product sync fails with RLS for cashier accounts.

drop policy if exists "products_write_manager_admin" on public.products;

create policy "products_insert_store_staff"
on public.products
for insert
with check (public.has_store_role(store_id, array['admin', 'manager', 'cashier']));

create policy "products_update_store_staff"
on public.products
for update
using (public.has_store_role(store_id, array['admin', 'manager', 'cashier']))
with check (public.has_store_role(store_id, array['admin', 'manager', 'cashier']));

create policy "products_delete_manager_admin"
on public.products
for delete
using (public.has_store_role(store_id, array['admin', 'manager']));

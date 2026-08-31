-- OmniPOS schema alignment for current mobile flow
-- Safe additive migration: extends existing tables used by app sync + checkout UX.

create extension if not exists pgcrypto;

-- Keep updated_at fresh for sync cursors and admin dashboards.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- stores: align with Home/Settings drawer and shop profile configuration
-- ---------------------------------------------------------------------------
alter table public.stores
  add column if not exists email text,
  add column if not exists logo_url text,
  add column if not exists language text not null default 'English',
  add column if not exists app_mode_dark boolean not null default false,
  add column if not exists tax_rate numeric(6,2) not null default 0 check (tax_rate >= 0 and tax_rate <= 100),
  add column if not exists vat_rate numeric(6,2) not null default 0 check (vat_rate >= 0 and vat_rate <= 100),
  add column if not exists service_rate numeric(6,2) not null default 0 check (service_rate >= 0 and service_rate <= 100);

drop trigger if exists trg_stores_updated_at on public.stores;
create trigger trg_stores_updated_at
before update on public.stores
for each row execute procedure public.set_updated_at();

-- ---------------------------------------------------------------------------
-- products: align with local model + scanner/image/tag UX
-- ---------------------------------------------------------------------------
alter table public.products
  add column if not exists barcode text,
  add column if not exists cost_price numeric(12,2) check (cost_price is null or cost_price >= 0),
  add column if not exists image_url text,
  add column if not exists tags text[] not null default '{}';

create index if not exists idx_products_store_updated_at on public.products(store_id, updated_at desc);
create index if not exists idx_products_store_barcode on public.products(store_id, barcode);

drop trigger if exists trg_products_updated_at on public.products;
create trigger trg_products_updated_at
before update on public.products
for each row execute procedure public.set_updated_at();

-- ---------------------------------------------------------------------------
-- orders: align with order-info and receipt breakdown fields
-- ---------------------------------------------------------------------------
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

drop trigger if exists trg_orders_updated_at on public.orders;
create trigger trg_orders_updated_at
before update on public.orders
for each row execute procedure public.set_updated_at();

-- Helpful for list pages / reports.
create index if not exists idx_orders_store_created_at on public.orders(store_id, created_at desc);

-- ---------------------------------------------------------------------------
-- returns: updated_at consistency
-- ---------------------------------------------------------------------------
drop trigger if exists trg_returns_updated_at on public.returns;
create trigger trg_returns_updated_at
before update on public.returns
for each row execute procedure public.set_updated_at();

-- ---------------------------------------------------------------------------
-- API exposure hardening for projects with "explicit grants" Data API mode
-- (safe no-op for projects already exposing public tables by default)
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;
grant select on public.stores, public.store_members, public.products, public.orders, public.returns to authenticated;
grant insert, update, delete on public.products, public.orders, public.returns to authenticated;

-- Note:
-- RLS remains the authoritative guardrail; these grants only expose tables to API.

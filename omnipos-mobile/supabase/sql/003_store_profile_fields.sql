-- Add onboarding profile fields for store configuration.
alter table public.stores
add column if not exists tax_profile text not null default 'standard',
add column if not exists currency text not null default 'USD',
add column if not exists timezone text not null default 'UTC';

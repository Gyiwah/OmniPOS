-- OmniPOS store staff invites
-- Run after 001/004 (or after 000 for fresh projects).

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.store_invites (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  email text not null,
  role text not null check (role in ('admin', 'manager', 'cashier')),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'revoked', 'expired')),
  invited_by uuid references public.profiles(id) on delete set null,
  accepted_user_id uuid references public.profiles(id) on delete set null,
  expires_at timestamptz not null default (now() + interval '14 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, email)
);

create index if not exists idx_store_invites_store_status
  on public.store_invites(store_id, status);

create index if not exists idx_store_invites_email_status
  on public.store_invites(lower(email), status);

drop trigger if exists trg_store_invites_updated_at on public.store_invites;
create trigger trg_store_invites_updated_at
before update on public.store_invites
for each row execute procedure public.set_updated_at();

alter table public.store_invites enable row level security;

drop policy if exists "store_invites_select_admin_manager" on public.store_invites;
create policy "store_invites_select_admin_manager"
on public.store_invites for select
using (public.has_store_role(store_id, array['admin', 'manager']));

drop policy if exists "store_invites_insert_admin_manager" on public.store_invites;
create policy "store_invites_insert_admin_manager"
on public.store_invites for insert
with check (public.has_store_role(store_id, array['admin', 'manager']));

drop policy if exists "store_invites_update_admin_manager" on public.store_invites;
create policy "store_invites_update_admin_manager"
on public.store_invites for update
using (public.has_store_role(store_id, array['admin', 'manager']))
with check (public.has_store_role(store_id, array['admin', 'manager']));

drop policy if exists "store_invites_delete_admin" on public.store_invites;
create policy "store_invites_delete_admin"
on public.store_invites for delete
using (public.has_store_role(store_id, array['admin']));

-- Accept all pending invites for the authenticated user's email.
create or replace function public.accept_pending_store_invites()
returns table(store_id uuid, role text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text;
  r record;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select lower(u.email) into v_email
  from auth.users u
  where u.id = v_user_id;

  if v_email is null or v_email = '' then
    return;
  end if;

  for r in
    select si.id, si.store_id, si.role
    from public.store_invites si
    where lower(si.email) = v_email
      and si.status = 'pending'
      and si.expires_at > now()
  loop
    insert into public.store_members (store_id, user_id, role, invited_by)
    values (r.store_id, v_user_id, r.role, null)
    on conflict (store_id, user_id) do update
      set role = excluded.role;

    update public.store_invites
    set
      status = 'accepted',
      accepted_user_id = v_user_id,
      updated_at = now()
    where id = r.id;

    store_id := r.store_id;
    role := r.role;
    return next;
  end loop;
end;
$$;

revoke all on function public.accept_pending_store_invites() from public;
grant execute on function public.accept_pending_store_invites() to authenticated;

grant select, insert, update, delete on public.store_invites to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'store_invites'
  ) then
    alter publication supabase_realtime add table public.store_invites;
  end if;
end $$;

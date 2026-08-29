-- Migration 013: Direct Store Provisioning RPC for Super Admins

create or replace function public.provision_store_with_admin(
  p_store_name text,
  p_currency text default 'USD',
  p_timezone text default 'UTC',
  p_tax_profile text default 'standard',
  p_admin_email text default null,
  p_admin_full_name text default null
)
returns json
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller_id uuid;
  v_is_super boolean;
  v_admin_user_id uuid;
  v_store record;
begin
  v_caller_id := auth.uid();
  if v_caller_id is null then
    raise exception 'Unauthorized';
  end if;

  select is_super_admin into v_is_super from public.profiles where id = v_caller_id;
  if not coalesce(v_is_super, false) then
    raise exception 'Only Super Admins can provision stores.';
  end if;

  -- Match existing user by email if provided
  if p_admin_email is not null and length(trim(p_admin_email)) > 0 then
    select id into v_admin_user_id from auth.users where lower(email) = lower(trim(p_admin_email)) limit 1;
  end if;

  if v_admin_user_id is null then
    v_admin_user_id := v_caller_id;
  end if;

  -- Create store
  insert into public.stores (name, currency, timezone, tax_profile, owner_user_id)
  values (
    trim(p_store_name),
    coalesce(nullif(trim(p_currency), ''), 'USD'),
    coalesce(nullif(trim(p_timezone), ''), 'UTC'),
    coalesce(nullif(trim(p_tax_profile), ''), 'standard'),
    v_admin_user_id
  )
  returning * into v_store;

  -- Add store member as admin
  insert into public.store_members (store_id, user_id, role)
  values (v_store.id, v_admin_user_id, 'admin')
  on conflict (store_id, user_id) do update set role = 'admin';

  -- Update profile full name if given
  if p_admin_full_name is not null and length(trim(p_admin_full_name)) > 0 then
    update public.profiles
    set full_name = trim(p_admin_full_name), updated_at = now()
    where id = v_admin_user_id;
  end if;

  return json_build_object(
    'store', row_to_json(v_store),
    'storeAdmin', json_build_object(
      'id', v_admin_user_id,
      'email', coalesce(p_admin_email, ''),
      'fullName', coalesce(p_admin_full_name, '')
    )
  );
end;
$$;

grant execute on function public.provision_store_with_admin to authenticated;

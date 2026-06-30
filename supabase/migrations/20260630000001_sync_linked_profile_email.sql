create or replace function public.link_current_user_profile()
returns public.users
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth_id uuid := auth.uid();
  v_email text := lower(auth.jwt() ->> 'email');
  v_name text := coalesce(
    auth.jwt() -> 'user_metadata' ->> 'full_name',
    auth.jwt() -> 'user_metadata' ->> 'name',
    ''
  );
  v_profile public.users;
begin
  if v_auth_id is null or v_email is null or v_email = '' then
    raise exception 'Authenticated user required';
  end if;

  select * into v_profile
  from public.users
  where auth_user_id = v_auth_id
     or lower(email) = v_email
  order by case when auth_user_id = v_auth_id then 0 else 1 end
  limit 1;

  if v_profile.id is null then
    insert into public.users (auth_user_id, name, email, type, status, role)
    values (v_auth_id, v_name, v_email, 'Novo', 'ok', 'client')
    returning * into v_profile;
  elsif v_profile.auth_user_id is null then
    update public.users
    set auth_user_id = v_auth_id,
        name = coalesce(nullif(v_profile.name, ''), v_name),
        email = v_email,
        updated_at = now()
    where id = v_profile.id
    returning * into v_profile;
  elsif lower(v_profile.email) <> v_email then
    update public.users
    set email = v_email,
        updated_at = now()
    where id = v_profile.id
    returning * into v_profile;
  end if;

  return v_profile;
end;
$$;

revoke all on function public.link_current_user_profile() from public;
grant execute on function public.link_current_user_profile() to authenticated;

create or replace function public.resolve_login_email(login_identifier text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_identifier text := lower(trim(coalesce(login_identifier, '')));
  phone_digits text := regexp_replace(coalesce(login_identifier, ''), '\D', '', 'g');
  resolved_email text;
begin
  if normalized_identifier like '%@%' then
    return normalized_identifier;
  end if;

  if length(phone_digits) < 10 then
    return null;
  end if;

  select lower(u.email)
    into resolved_email
  from public.users u
  where regexp_replace(coalesce(u.phone, ''), '\D', '', 'g') = phone_digits
    and u.role = 'client'
  order by u.updated_at desc nulls last, u.created_at desc nulls last
  limit 1;

  return resolved_email;
end;
$$;

revoke all on function public.resolve_login_email(text) from public;
grant execute on function public.resolve_login_email(text) to anon, authenticated;

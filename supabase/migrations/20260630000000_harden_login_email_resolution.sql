create or replace function public.normalize_br_phone(phone_value text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when length(digits) in (12, 13) and left(digits, 2) = '55' then substring(digits from 3)
    else digits
  end
  from (select regexp_replace(coalesce(phone_value, ''), '\D', '', 'g') as digits) normalized;
$$;

create or replace function public.resolve_login_email(login_identifier text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_identifier text := lower(trim(coalesce(login_identifier, '')));
  phone_digits text := public.normalize_br_phone(login_identifier);
  resolved_email text;
  match_count integer := 0;
begin
  if normalized_identifier like '%@%' then
    return normalized_identifier;
  end if;

  if length(phone_digits) < 10 then
    return null;
  end if;

  select count(*), min(lower(u.email))
    into match_count, resolved_email
  from public.users u
  where public.normalize_br_phone(u.phone) = phone_digits
    and u.role = 'client';

  if match_count = 1 then
    return resolved_email;
  end if;

  return null;
end;
$$;

revoke all on function public.normalize_br_phone(text) from public;
grant execute on function public.normalize_br_phone(text) to anon, authenticated;
revoke all on function public.resolve_login_email(text) from public;
grant execute on function public.resolve_login_email(text) to anon, authenticated;

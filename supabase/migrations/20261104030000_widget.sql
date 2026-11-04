-- Scriptable widget: one personal token per user, stored only as a SHA-256 hash.
create table private.widget_tokens (
  user_id uuid primary key references auth.users on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now()
);

create function public.set_widget_token(p_user uuid, p_hash text)
returns void language sql security definer set search_path = '' as $$
  insert into private.widget_tokens (user_id, token_hash) values (p_user, p_hash)
  on conflict (user_id) do update set token_hash = excluded.token_hash, created_at = now();
$$;

create function public.revoke_widget_token(p_user uuid)
returns void language sql security definer set search_path = '' as $$
  delete from private.widget_tokens where user_id = p_user;
$$;

create function public.widget_user(p_hash text)
returns uuid language sql security definer stable set search_path = '' as $$
  select user_id from private.widget_tokens where token_hash = p_hash;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'set_widget_token(uuid, text)', 'revoke_widget_token(uuid)', 'widget_user(text)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

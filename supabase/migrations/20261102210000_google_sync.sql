-- Link back to the original event (Google / iCloud web UI).
alter table public.calendar_events add column link text;

-- App state that is not an entity (proposals, temporary relaxations).
alter table public.settings add column state jsonb not null default '{}';

-- Token access for edge functions only. The private schema is not exposed through
-- the API, so these SECURITY DEFINER functions are the one door, and only the
-- service role may call them.
create function public.store_oauth_token(p_user uuid, p_provider text, p_token text)
returns void language sql security definer set search_path = '' as $$
  insert into private.oauth_tokens (user_id, provider, refresh_token, updated_at)
  values (p_user, p_provider, p_token, now())
  on conflict (user_id, provider)
  do update set refresh_token = excluded.refresh_token, updated_at = now();
$$;

create function public.get_oauth_token(p_user uuid, p_provider text)
returns text language sql security definer stable set search_path = '' as $$
  select refresh_token from private.oauth_tokens where user_id = p_user and provider = p_provider;
$$;

revoke execute on function public.store_oauth_token(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.get_oauth_token(uuid, text) from public, anon, authenticated;
grant execute on function public.store_oauth_token(uuid, text, text) to service_role;
grant execute on function public.get_oauth_token(uuid, text) to service_role;

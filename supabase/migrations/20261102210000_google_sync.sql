-- Link back to the original event (Google / iCloud web UI).
alter table public.calendar_events add column link text;

-- App state that is not an entity (proposals, temporary relaxations).
alter table public.settings add column state jsonb not null default '{}';

-- Refresh tokens are encrypted with Supabase Vault; the private table only keeps
-- the vault secret id. The private schema is not exposed through the API, so these
-- SECURITY DEFINER functions are the one door, and only the service role may call them.
alter table private.oauth_tokens drop column refresh_token;
alter table private.oauth_tokens add column secret_id uuid not null;

create function public.store_oauth_token(p_user uuid, p_provider text, p_token text)
returns void language plpgsql security definer set search_path = '' as $$
declare sid uuid;
begin
  select secret_id into sid from private.oauth_tokens where user_id = p_user and provider = p_provider;
  if sid is null then
    sid := vault.create_secret(p_token, format('oauth:%s:%s', p_user, p_provider));
    insert into private.oauth_tokens (user_id, provider, secret_id) values (p_user, p_provider, sid);
  else
    perform vault.update_secret(sid, p_token);
    update private.oauth_tokens set updated_at = now() where user_id = p_user and provider = p_provider;
  end if;
end $$;

create function public.get_oauth_token(p_user uuid, p_provider text)
returns text language sql security definer stable set search_path = '' as $$
  select s.decrypted_secret
  from private.oauth_tokens t
  join vault.decrypted_secrets s on s.id = t.secret_id
  where t.user_id = p_user and t.provider = p_provider;
$$;

revoke execute on function public.store_oauth_token(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.get_oauth_token(uuid, text) from public, anon, authenticated;
grant execute on function public.store_oauth_token(uuid, text, text) to service_role;
grant execute on function public.get_oauth_token(uuid, text) to service_role;

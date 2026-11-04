-- Server-side sync: Google push channels, a 5-minute cron that calls the production
-- deployment, and the bookkeeping that keeps webhook bursts from re-syncing at once.

-- Google push notification channels (one per watched calendar). Only the service
-- role uses them: RLS on with no policy, and no grants for API users.
create table public.google_channels (
  id text primary key,
  user_id uuid not null references auth.users on delete cascade,
  calendar_id text not null,
  resource_id text not null,
  secret text not null,
  expires_at timestamptz not null
);
create index on public.google_channels (user_id);
alter table public.google_channels enable row level security;
revoke all on public.google_channels from anon, authenticated;
grant select, insert, update, delete on public.google_channels to service_role;

-- When each user's calendars were last synced server-side; `pending` marks a webhook
-- that arrived during a sync, for the next cron tick.
create table private.sync_state (
  user_id uuid primary key references auth.users on delete cascade,
  ran_at timestamptz,
  pending boolean not null default false
);

-- Values the database itself needs: the production origin (registered by the app's
-- functions) and the key the cron sends, generated here so it never leaves Postgres
-- except in that request.
create table private.app_config (
  key text primary key,
  value text not null
);
insert into private.app_config (key, value)
values ('cron_key', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (key) do nothing;

create function public.register_app_url(p_url text)
returns void language sql security definer set search_path = '' as $$
  insert into private.app_config (key, value) values ('app_url', p_url)
  on conflict (key) do update set value = excluded.value;
$$;

create function public.check_cron_key(p_key text)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (select 1 from private.app_config where key = 'cron_key' and value = p_key);
$$;

-- True when the caller may sync this user now (nothing ran in the last `p_gap`);
-- otherwise remembers the request for the next tick.
create function public.claim_sync(p_user uuid, p_gap interval)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  insert into private.sync_state (user_id) values (p_user) on conflict (user_id) do nothing;
  update private.sync_state set ran_at = now(), pending = false
    where user_id = p_user and (pending or ran_at is null or ran_at < now() - p_gap);
  if found then return true; end if;
  update private.sync_state set pending = true where user_id = p_user;
  return false;
end $$;

-- Users with a connected calendar: the ones the cron syncs.
create function public.connected_users()
returns setof uuid language sql security definer stable set search_path = '' as $$
  select distinct user_id from private.oauth_tokens;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'register_app_url(text)', 'check_cron_key(text)', 'claim_sync(uuid, interval)',
    'connected_users()'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- Every 5 minutes: ask the production deployment to sync, re-plan and notify.
-- Staging never registers an origin, so its tick does nothing.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create function private.tick()
returns void language plpgsql security definer set search_path = '' as $$
declare
  origin text;
  cron_key text;
begin
  select value into origin from private.app_config where key = 'app_url';
  select value into cron_key from private.app_config where key = 'cron_key';
  if origin is null then return; end if;
  perform net.http_post(
    url := origin || '/api/cron',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'X-Cron-Key', cron_key),
    timeout_milliseconds := 30000
  );
end $$;

select cron.schedule('critical-tick', '*/5 * * * *', 'select private.tick()');

-- Bus trips (SPEC §15), data half: the schedules the server computes routes from, the
-- user's saved regular routes, and the weekly import.

-- One row per source feed (`stm` = Montevideo's urban system, `dnt` = the metropolitan
-- lines of the national transport directorate). `payload` is the compacted schedule
-- (gzip of JSON, base64): a few MB instead of the 2.3 million raw stop passes. Only the
-- service role reads it: RLS on with no policy, and no grants for API users.
create table public.transit_feed (
  source text primary key check (source in ('stm', 'dnt')),
  version text not null,
  built_at timestamptz not null default now(),
  -- Last day the schedules cover, when the source says so.
  valid_to date,
  stats jsonb not null default '{}',
  payload text not null
);
alter table public.transit_feed enable row level security;
revoke all on public.transit_feed from anon, authenticated;
grant select, insert, update, delete on public.transit_feed to service_role;

-- Regular routes: "home → work on Tuesdays, there by 9:00" with the bus chosen, so it
-- is not recomputed every day. The app recomputes one when `feed_version` no longer
-- matches the feed, when its time changes, when its schedule does not run that day, or
-- when the user asks.
create table public.bus_routes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  from_place uuid not null,
  to_place uuid not null,
  -- ISO weekday (1 = Monday … 7 = Sunday); null = every day.
  weekday smallint check (weekday between 1 and 7),
  -- Minute of the day (0–1439) the user wants to arrive by or to leave at.
  time_minutes int not null check (time_minutes between 0 and 1439),
  mode text not null check (mode in ('arrive', 'depart')),
  -- The chosen option, as /api/transit returned it.
  plan jsonb not null check (jsonb_typeof(plan) = 'object' and pg_column_size(plan) < 16384),
  -- Versions of the feeds the plan was computed from ("stm:…|dnt:…").
  feed_version text not null check (length(feed_version) <= 200),
  computed_at timestamptz not null default now(),
  -- True when any leg comes from a theoretical schedule rather than live passes.
  theoretical boolean not null default true,
  unique (id, user_id),
  foreign key (from_place, user_id) references public.places (id, user_id) on delete cascade,
  foreign key (to_place, user_id) references public.places (id, user_id) on delete cascade,
  check (from_place <> to_place)
);
create unique index bus_routes_slot on public.bus_routes
  (user_id, from_place, to_place, coalesce(weekday, 0), mode, time_minutes);
create index on public.bus_routes (user_id, from_place, to_place);

alter table public.bus_routes enable row level security;
create policy own_rows on public.bus_routes for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.bus_routes to authenticated, service_role;
revoke all on public.bus_routes from anon;

-- Weekly import: Monday 03:00 Montevideo (06:00 UTC), when nobody is planning. Like the
-- 5-minute tick, it only runs where the app registered its production origin.
create function private.transit_tick()
returns void language plpgsql security definer set search_path = '' as $$
declare
  origin text;
  cron_key text;
begin
  select value into origin from private.app_config where key = 'app_url';
  select value into cron_key from private.app_config where key = 'cron_key';
  if origin is null then return; end if;
  perform net.http_post(
    url := origin || '/api/transit-import',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'X-Cron-Key', cron_key),
    timeout_milliseconds := 60000
  );
end $$;

select cron.schedule('critical-transit-import', '0 6 * * 1', 'select private.transit_tick()');

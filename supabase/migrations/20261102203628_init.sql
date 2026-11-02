-- critiCal initial schema. Every public table is per-user and protected by RLS.
-- Source of truth: activities, tasks, units, check-ins (append-only), settings.
-- Derived/cached: plan_blocks, calendar_events, travel_times.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.settings (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  color text not null,
  academic boolean not null default true,
  max_session_minutes int not null default 120 check (max_session_minutes > 0),
  min_block_minutes int not null default 60 check (min_block_minutes > 0),
  preferred_start int check (preferred_start between 0 and 2880),
  preferred_end int check (preferred_end between 0 and 2880),
  weekly_min_minutes int check (weekly_min_minutes >= 0),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique (id, user_id)
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  activity_id uuid not null,
  title text not null,
  kind text not null default 'deliverable' check (kind in ('deliverable', 'habit')),
  deadline timestamptz,
  estimate_minutes int check (estimate_minutes >= 0),
  min_minutes int not null default 0 check (min_minutes >= 0),
  session_minutes int check (session_minutes > 0),
  sessions_per_week int check (sessions_per_week > 0),
  max_per_day_minutes int check (max_per_day_minutes > 0),
  priority smallint not null default 1 check (priority between 1 and 3),
  source_event_id text,
  status text not null default 'active' check (status in ('active', 'done', 'dropped')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  -- Same owner on both sides: foreign-key checks bypass RLS.
  foreign key (activity_id, user_id) references public.activities (id, user_id) on delete cascade
);

create table public.task_units (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  task_id uuid not null,
  title text not null,
  estimate_minutes int not null check (estimate_minutes >= 0),
  position int not null default 0,
  done_at timestamptz,
  foreign key (task_id, user_id) references public.tasks (id, user_id) on delete cascade
);

-- Append-only log of what really happened in each planned block. Tasks with
-- check-ins cannot be deleted (archive them instead), so the log never changes.
create table public.check_ins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  block_id text not null,
  task_id uuid not null,
  status text not null check (status in ('done', 'missed', 'partial')),
  minutes_done int not null default 0 check (minutes_done >= 0),
  unit_ids uuid[] not null default '{}',
  note text,
  created_at timestamptz not null default now(),
  foreign key (task_id, user_id) references public.tasks (id, user_id)
);

create table public.plan_blocks (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  id text not null,
  task_id uuid not null,
  start_at timestamptz not null,
  end_at timestamptz not null check (end_at > start_at),
  level text not null default 'ok' check (level in ('ok', 'warn', 'critical')),
  soft boolean not null default false,
  google_event_id text,
  seen_at timestamptz,
  primary key (user_id, id),
  foreign key (task_id, user_id) references public.tasks (id, user_id) on delete cascade
);

create table public.calendar_events (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  source text not null check (source in ('google', 'icloud')),
  external_id text not null,
  calendar_id text,
  title text not null default '',
  start_at timestamptz not null,
  end_at timestamptz not null,
  location text,
  busy boolean not null default true,
  all_day boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, source, external_id)
);

create table public.day_overrides (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  date date not null,
  wake int check (wake between 0 and 1440),
  bed int check (bed between 0 and 1440),
  primary key (user_id, date)
);

create table public.places (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  aliases text[] not null default '{}',
  lat double precision,
  lon double precision,
  is_home boolean not null default false,
  unique (id, user_id)
);

create table public.travel_times (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  from_place uuid not null,
  to_place uuid not null,
  minutes int not null check (minutes >= 0),
  manual boolean not null default false,
  primary key (user_id, from_place, to_place),
  foreign key (from_place, user_id) references public.places (id, user_id) on delete cascade,
  foreign key (to_place, user_id) references public.places (id, user_id) on delete cascade
);

-- Changes to today's plan wait here for the user's OK.
create table public.proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  kind text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution text
);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  endpoint text not null unique,
  keys jsonb not null,
  created_at timestamptz not null default now()
);

-- OAuth refresh tokens: not exposed through the API, only edge functions (service role).
create table private.oauth_tokens (
  user_id uuid not null references auth.users on delete cascade,
  provider text not null,
  refresh_token text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, provider)
);

grant usage on schema private to service_role;
grant select, insert, update, delete on private.oauth_tokens to service_role;

create index on public.tasks (user_id, status);
create index on public.task_units (task_id);
create index on public.check_ins (user_id, created_at);
create index on public.plan_blocks (user_id, start_at);
create index on public.calendar_events (user_id, start_at);

-- Row level security: each user sees only their rows.
do $$
declare t text;
begin
  foreach t in array array[
    'settings', 'activities', 'tasks', 'task_units', 'plan_blocks', 'calendar_events',
    'day_overrides', 'places', 'travel_times', 'proposals', 'push_subscriptions'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy own_rows on public.%I for all to authenticated
         using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
      t
    );
  end loop;
end $$;

-- Check-ins can be added and read, never edited or deleted.
alter table public.check_ins enable row level security;
create policy own_select on public.check_ins for select to authenticated
  using (user_id = (select auth.uid()));
create policy own_insert on public.check_ins for insert to authenticated
  with check (user_id = (select auth.uid()));

create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger tasks_touch before update on public.tasks
  for each row execute function public.touch_updated_at();
create trigger settings_touch before update on public.settings
  for each row execute function public.touch_updated_at();

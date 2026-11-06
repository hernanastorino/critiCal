begin;
create extension if not exists pgtap with schema extensions;
-- Start from an app without accounts: the local seed's test account would own it.
delete from auth.users where email = 'prueba@critical.test';
delete from private.app_config where key = 'owner';
delete from public.invites;
select plan(13);

-- A owns the app; B and C are invited Google accounts.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'owner@test.local'),
  ('00000000-0000-0000-0000-0000000000d2', 'leaving@test.local'),
  ('00000000-0000-0000-0000-0000000000d3', 'staying@test.local');
insert into auth.identities (provider_id, user_id, identity_data, provider) values
  ('google-d2', '00000000-0000-0000-0000-0000000000d2', '{"email": "Leaving@test.local"}', 'google'),
  ('google-d3', '00000000-0000-0000-0000-0000000000d3', '{"email": "staying@test.local"}', 'google');
insert into public.invites (email) values ('leaving@test.local'), ('staying@test.local');
-- Whatever this database had, A is the owner here.
insert into private.app_config (key, value) values ('owner', '00000000-0000-0000-0000-0000000000d1')
on conflict (key) do update set value = excluded.value;

/** Rows of a user in every table that has a user_id, in every schema of the app. */
create function pg_temp.rows_of(p_user uuid) returns int language plpgsql as $$
declare
  t record;
  n int;
  total int := 0;
begin
  for t in
    select c.table_schema, c.table_name from information_schema.columns c
    join information_schema.tables x using (table_schema, table_name)
    where c.column_name = 'user_id' and x.table_type = 'BASE TABLE'
      and c.table_schema in ('public', 'private')
  loop
    execute format('select count(*) from %I.%I where user_id = $1', t.table_schema, t.table_name)
      into n using p_user;
    total := total + n;
  end loop;
  return total;
end $$;

-- B and C fill every user table the same way.
create function pg_temp.fill(p_user uuid) returns void language plpgsql as $$
declare
  a uuid := gen_random_uuid();
  t uuid := gen_random_uuid();
  p1 uuid := gen_random_uuid();
  p2 uuid := gen_random_uuid();
begin
  insert into public.settings (user_id, data, google_plan_calendar) values (p_user, '{}', 'plan');
  insert into public.activities (id, user_id, name, color) values (a, p_user, 'Matemática', '#f80');
  insert into public.tasks (id, user_id, activity_id, title) values (t, p_user, a, 'Práctico');
  insert into public.task_units (user_id, task_id, title, estimate_minutes)
    values (p_user, t, 'Ej. 1', 30);
  insert into public.check_ins (user_id, block_id, task_id, status) values (p_user, 'b', t, 'done');
  insert into public.plan_blocks (user_id, id, task_id, start_at, end_at)
    values (p_user, 'b', t, now(), now() + interval '1 hour');
  insert into public.calendars (user_id, source, external_id, name)
    values (p_user, 'google', 'g', 'Facultad'), (p_user, 'icloud', 'i', 'Casa');
  insert into public.calendar_events (user_id, source, external_id, start_at, end_at)
    values (p_user, 'google', 'e', now(), now() + interval '1 hour');
  insert into public.day_overrides (user_id, date, wake) values (p_user, current_date, 480);
  insert into public.places (id, user_id, name) values (p1, p_user, 'Casa'), (p2, p_user, 'Facu');
  insert into public.travel_times (user_id, from_place, to_place, minutes)
    values (p_user, p1, p2, 20);
  insert into public.proposals (user_id, kind, payload) values (p_user, 'x', '{}');
  insert into public.push_subscriptions (user_id, endpoint, keys)
    values (p_user, 'https://push/' || p_user, '{}');
  insert into public.google_channels (id, user_id, calendar_id, resource_id, secret, expires_at)
    values ('ch-' || p_user, p_user, 'g', 'r', 's', now() + interval '1 day');
  insert into private.sync_state (user_id) values (p_user);
  insert into private.push_log (user_id, key) values (p_user, 'k');
  perform public.store_oauth_token(p_user, 'google', 'refresh');
  perform public.store_oauth_token(p_user, 'icloud', '{"appleId":"x","appPassword":"y"}');
  perform public.store_oauth_token(p_user, 'gemini', 'key');
  perform public.set_widget_token(p_user, 'hash-' || p_user);
end $$;

select pg_temp.fill('00000000-0000-0000-0000-0000000000d2');
select pg_temp.fill('00000000-0000-0000-0000-0000000000d3');
select cmp_ok(pg_temp.rows_of('00000000-0000-0000-0000-0000000000d2'), '>=', 20, 'B has data everywhere');
create temp table c_before as select pg_temp.rows_of('00000000-0000-0000-0000-0000000000d3') as n;

-- RLS: nobody calls these from the app, not even for themselves.
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000d2"}';
select throws_ok(
  $$ select public.delete_account('00000000-0000-0000-0000-0000000000d3') $$,
  '42501', null, 'a user cannot delete another account'
);
select throws_ok(
  $$ select public.delete_account('00000000-0000-0000-0000-0000000000d2') $$,
  '42501', null, 'nor their own without the server'
);
select throws_ok(
  $$ select public.revoke_connections('00000000-0000-0000-0000-0000000000d3') $$,
  '42501', null, 'a user cannot revoke another account'
);
reset role;

set local role service_role;
select throws_ok(
  $$ select public.delete_account('00000000-0000-0000-0000-0000000000d1') $$,
  'P0001', 'owner_cannot_delete', 'the owner cannot delete their account'
);
select lives_ok(
  $$ select public.delete_account('00000000-0000-0000-0000-0000000000d2') $$,
  'the server deletes an account'
);
reset role;

select is(pg_temp.rows_of('00000000-0000-0000-0000-0000000000d2'), 0, 'no row of B is left anywhere');
select is(
  (select count(*)::int from auth.users where id = '00000000-0000-0000-0000-0000000000d2'),
  0, 'the account is gone'
);
select is(
  (select count(*)::int from vault.secrets
   where name like 'oauth:00000000-0000-0000-0000-0000000000d2:%'),
  0, 'its Google and iCloud credentials and Gemini key are gone from the vault'
);
select is(
  (select array_agg(email order by email) from public.invites),
  array['staying@test.local'], 'its invitation is gone, the others stay'
);
select is(
  pg_temp.rows_of('00000000-0000-0000-0000-0000000000d3'),
  (select n from c_before),
  'C keeps all its data'
);

-- Revoking alone keeps the account and its plan, but no secret or imported calendar.
set local role service_role;
select public.revoke_connections('00000000-0000-0000-0000-0000000000d3');
reset role;
select is(
  (select count(*)::int from vault.secrets
   where name like 'oauth:00000000-0000-0000-0000-0000000000d3:%')
  + (select count(*)::int from private.oauth_tokens
     where user_id = '00000000-0000-0000-0000-0000000000d3')
  + (select count(*)::int from private.widget_tokens
     where user_id = '00000000-0000-0000-0000-0000000000d3')
  + (select count(*)::int from public.calendars
     where user_id = '00000000-0000-0000-0000-0000000000d3')
  + (select count(*)::int from public.calendar_events
     where user_id = '00000000-0000-0000-0000-0000000000d3'),
  0, 'revoking forgets every secret and imported calendar'
);
select is(
  (select count(*)::int from public.tasks where user_id = '00000000-0000-0000-0000-0000000000d3'),
  1, 'and keeps the plan'
);

select * from finish();
rollback;

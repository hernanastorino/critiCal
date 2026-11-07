begin;
create extension if not exists pgtap with schema extensions;
-- Start from an app without accounts: the local seed's test account would own it.
delete from auth.users where email = 'prueba@critical.test';
delete from private.app_config where key = 'owner';
select plan(10);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000c1', 'cfg@test.local');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000c1"}';

select lives_ok(
  $$ insert into public.settings (data) values ('{"timezone": "America/Montevideo", "maxActivitiesPerDay": 2, "week": [{}, {}, {}, {}, {}, {}, {}]}') $$,
  'valid settings are saved'
);
select lives_ok(
  $$ update public.settings set data = '{}' $$,
  'every key is optional'
);
select throws_ok(
  $$ update public.settings set data = '{"week": [1, 2, 3]}' $$,
  '22023', 'invalid settings data', 'a week that is not 7 days is refused'
);
select throws_ok(
  $$ update public.settings set data = '{"maxActivitiesPerDay": "2"}' $$,
  '22023', 'invalid settings data', 'a number as text is refused'
);
select throws_ok(
  $$ update public.settings set data = '{"week": [1,2,3,4,5,6,7]}' $$,
  '22023', 'invalid settings data', 'a week of non-objects is refused'
);
select throws_ok(
  $$ update public.settings set data = '[]' $$,
  '22023', 'invalid settings data', 'data must be an object'
);
select throws_ok(
  $$ update public.settings set data = jsonb_build_object('timezone', repeat('x', 70000)) $$,
  '22023', 'invalid settings data', 'a huge value is refused'
);

-- An old row that does not comply can still change its other columns.
reset role;
alter table public.settings disable trigger settings_data_check;
update public.settings set data = '{"week": [1]}';
alter table public.settings enable trigger settings_data_check;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000c1"}';
select lives_ok(
  $$ update public.settings set google_plan_calendar = 'x' $$,
  'an old row is not locked out of other updates'
);

-- The app saves with an upsert: a legacy row's unchanged data goes through, a changed bad one does not.
select lives_ok(
  $$ insert into public.settings (user_id, data, state) values ('00000000-0000-0000-0000-0000000000c1', '{"week": [1]}', '{"x": 1}')
     on conflict (user_id) do update set data = excluded.data, state = excluded.state $$,
  'an upsert that leaves legacy data as it was is saved'
);
select throws_ok(
  $$ insert into public.settings (user_id, data) values ('00000000-0000-0000-0000-0000000000c1', '{"week": [1, 2]}')
     on conflict (user_id) do update set data = excluded.data $$,
  '22023', 'invalid settings data', 'an upsert that changes it to another bad value is refused'
);

select * from finish();
rollback;

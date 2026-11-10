begin;
create extension if not exists pgtap with schema extensions;
-- Start from an app without accounts: the local seed's test account would own it.
delete from auth.users where email = 'prueba@critical.test';
delete from private.app_config where key = 'owner';
select plan(12);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'c1@test.local'),
  ('00000000-0000-0000-0000-0000000000c2', 'c2@test.local');

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000c1"}';
insert into public.places (id, name) values
  ('00000000-0000-0000-0000-0000000000a1', 'Casa'),
  ('00000000-0000-0000-0000-0000000000a2', 'Trabajo');
insert into public.bus_routes (id, from_place, to_place, weekday, time_minutes, mode, plan, feed_version)
values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1',
        '00000000-0000-0000-0000-0000000000a2', 2, 540, 'arrive', '{"option": {}}', 'stm:ab|dnt:cd');
select is((select count(*)::int from public.bus_routes), 1, 'owner sees their route');

-- A route is one per place pair, weekday, mode and time.
select throws_ok(
  $$ insert into public.bus_routes (from_place, to_place, weekday, time_minutes, mode, plan, feed_version)
     values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2',
             2, 540, 'arrive', '{}', 'x') $$,
  '23505', null, 'the same slot cannot be saved twice'
);
select lives_ok(
  $$ insert into public.bus_routes (from_place, to_place, weekday, time_minutes, mode, plan, feed_version)
     values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2',
             null, 540, 'arrive', '{}', 'x') $$,
  'every day is a different slot from Tuesday'
);
select throws_ok(
  $$ insert into public.bus_routes (from_place, to_place, weekday, time_minutes, mode, plan, feed_version)
     values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2',
             null, 540, 'arrive', '{}', 'y') $$,
  '23505', null, 'and "every day" is one slot, not many (null weekday)'
);
select throws_ok(
  $$ insert into public.bus_routes (from_place, to_place, time_minutes, mode, plan, feed_version)
     values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1',
             600, 'arrive', '{}', 'x') $$,
  '23514', null, 'a route needs two different places'
);
select throws_ok(
  $$ insert into public.bus_routes (from_place, to_place, time_minutes, mode, plan, feed_version)
     values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2',
             1440, 'arrive', '{}', 'x') $$,
  '23514', null, 'the time is a minute of the day'
);
select throws_ok(
  $$ insert into public.bus_routes (from_place, to_place, time_minutes, mode, plan, feed_version)
     values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2',
             600, 'arrive', '[]', 'x') $$,
  '23514', null, 'the plan is an object'
);
select throws_ok(
  $$ insert into public.bus_routes (from_place, to_place, time_minutes, mode, plan, feed_version)
     values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2',
             600, 'arrive', jsonb_build_object('x', repeat('a', 20000)), 'x') $$,
  '23514', null, 'and a bounded one'
);

-- Another user sees nothing, and cannot attach a route to someone else's places.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000c2"}';
select is((select count(*)::int from public.bus_routes), 0, 'others do not see it');
select throws_ok(
  $$ insert into public.bus_routes (from_place, to_place, time_minutes, mode, plan, feed_version)
     values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2',
             600, 'arrive', '{}', 'x') $$,
  '23503', null, 'places of another user cannot be used'
);

-- The schedules are for the server only.
select throws_ok($$ select * from public.transit_feed $$, '42501', null, 'users cannot read the feeds');

-- Deleting a place takes its routes along.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000c1"}';
delete from public.places where id = '00000000-0000-0000-0000-0000000000a2';
select is((select count(*)::int from public.bus_routes), 0, 'routes go with their place');

select * from finish();
rollback;

begin;
create extension if not exists pgtap with schema extensions;
delete from auth.users where email = 'prueba@critical.test';
delete from private.app_config where key = 'owner';
select plan(4);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'd1@test.local'),
  ('00000000-0000-0000-0000-0000000000d2', 'd2@test.local');

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000d1"}';
insert into public.meal_runs (meal, weekday, from_date, to_date, start_minutes, end_minutes)
values ('almuerzo', 2, '2026-11-03', null, 780, 840);
select is((select count(*)::int from public.meal_runs), 1, 'owner sees their run');
select lives_ok(
  $$ update public.meal_runs set to_date = '2026-11-09' where meal = 'almuerzo' $$,
  'a run can be closed'
);
select throws_ok(
  $$ insert into public.meal_runs (meal, weekday, from_date, start_minutes, end_minutes)
     values ('brunch', 1, '2026-11-03', 600, 660) $$,
  '23514', null, 'only known meals'
);

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000d2"}';
select is((select count(*)::int from public.meal_runs), 0, 'others do not see it');

select * from finish();
rollback;

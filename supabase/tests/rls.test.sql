begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test.local');

-- User A creates data.
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a"}';
insert into public.activities (id, name, color)
  values ('00000000-0000-0000-0000-0000000000a1', 'Matemática', '#f80');
insert into public.tasks (activity_id, title, min_minutes)
  select id, 'Práctico 5', 60 from public.activities;
insert into public.check_ins (block_id, task_id, status)
  select 'b1', id, 'done' from public.tasks;

select is((select count(*)::int from public.tasks), 1, 'A sees own task');

-- User B sees nothing of A and cannot write as A.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b"}';
select is((select count(*)::int from public.activities), 0, 'B cannot see A activities');
select is((select count(*)::int from public.check_ins), 0, 'B cannot see A check-ins');
select throws_ok(
  $$ insert into public.activities (user_id, name, color)
     values ('00000000-0000-0000-0000-00000000000a', 'x', '#000') $$,
  '42501', null, 'B cannot insert rows for A'
);
select throws_ok(
  $$ insert into public.tasks (activity_id, title)
     values ('00000000-0000-0000-0000-0000000000a1', 'x') $$,
  '23503', null, 'B cannot attach a task to A activity'
);
select throws_ok(
  $$ select * from private.oauth_tokens $$,
  '42501', null, 'tokens are not reachable through the API'
);

-- Check-ins are append-only.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a"}';
update public.check_ins set status = 'missed';
select is((select status from public.check_ins), 'done', 'check-ins cannot be edited');
delete from public.check_ins;
select is((select count(*)::int from public.check_ins), 1, 'check-ins cannot be deleted');
select throws_ok(
  $$ delete from public.tasks $$,
  '23503', null, 'tasks with check-ins cannot be deleted'
);

select * from finish();
rollback;

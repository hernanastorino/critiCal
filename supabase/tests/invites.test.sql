begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'owner@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', 'Friend@Test.local'),
  ('00000000-0000-0000-0000-0000000000a3', 'stranger@test.local');
insert into private.app_config (key, value)
values ('owner', '00000000-0000-0000-0000-0000000000a1')
on conflict (key) do update set value = excluded.value;
insert into public.invites (email) values ('friend@test.local');

select throws_ok(
  $$ insert into public.invites (email) values ('Mixed@Case.local') $$,
  '23514', null, 'invited emails are stored lowercase'
);

-- The owner.
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000a1"}';
select is(
  public.my_access()::jsonb, '{"invited": true, "owner": true}'::jsonb, 'the owner is in'
);
insert into public.invites (email) values ('new@test.local');
select is((select count(*)::int from public.invites), 2, 'the owner sees and edits the list');

-- An invited friend (email matched case-insensitively).
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000a2"}';
select is(
  public.my_access()::jsonb, '{"invited": true, "owner": false}'::jsonb, 'a friend is in'
);
select lives_ok(
  $$ insert into public.settings (data) values ('{}') $$, 'a friend stores their own data'
);
select is((select count(*)::int from public.invites), 0, 'a friend cannot see the list');
select throws_ok(
  $$ insert into public.invites (email) values ('other@test.local') $$,
  '42501', null, 'a friend cannot invite'
);

-- Someone who signed in without an invitation.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000a3"}';
select is(
  public.my_access()::jsonb, '{"invited": false, "owner": false}'::jsonb, 'a stranger is out'
);
select throws_ok(
  $$ insert into public.settings (data) values ('{}') $$,
  '42501', null, 'a stranger stores nothing'
);
select throws_ok(
  $$ select public.user_invited('00000000-0000-0000-0000-0000000000a3') $$,
  '42501', null, 'users cannot ask about others'
);

reset role;
set local role service_role;
select ok(
  not public.claim_sync('00000000-0000-0000-0000-0000000000a3', interval '1 minute'),
  'background sync skips a stranger'
);

select * from finish();
rollback;

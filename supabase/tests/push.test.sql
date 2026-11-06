begin;
create extension if not exists pgtap with schema extensions;
-- Start from an app without accounts: the local seed's test account would own it.
delete from auth.users where email = 'prueba@critical.test';
delete from private.app_config where key = 'owner';
select plan(4);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000e', 'e@test.local');

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000e"}';
select throws_ok(
  $$ select public.claim_push('00000000-0000-0000-0000-00000000000e', 'k') $$,
  '42501', null, 'users cannot mark notifications as sent'
);
insert into public.push_subscriptions (endpoint, keys) values ('https://push.example/1', '{}');
select is(
  (select count(*)::int from public.push_subscriptions),
  1,
  'users store their own subscription'
);

reset role;
set local role service_role;
select ok(public.claim_push('00000000-0000-0000-0000-00000000000e', 'critical:b1'), 'first send');
select ok(not public.claim_push('00000000-0000-0000-0000-00000000000e', 'critical:b1'), 'never twice');

select * from finish();
rollback;

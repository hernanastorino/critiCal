begin;
create extension if not exists pgtap with schema extensions;
-- Start from an app without accounts: the local seed's test account would own it.
delete from auth.users where email = 'prueba@critical.test';
delete from private.app_config where key = 'owner';
select plan(4);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000f', 'f@test.local');

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000f"}';
select throws_ok(
  $$ select public.widget_user('h') $$,
  '42501', null, 'users cannot look up widget tokens'
);

reset role;
set local role service_role;
select public.set_widget_token('00000000-0000-0000-0000-00000000000f', 'h1');
select is(public.widget_user('h1'), '00000000-0000-0000-0000-00000000000f'::uuid, 'token finds its user');
select public.set_widget_token('00000000-0000-0000-0000-00000000000f', 'h2');
select is(public.widget_user('h1'), null, 'a new token replaces the old one');
select public.revoke_widget_token('00000000-0000-0000-0000-00000000000f');
select is(public.widget_user('h2'), null, 'revoked');

select * from finish();
rollback;

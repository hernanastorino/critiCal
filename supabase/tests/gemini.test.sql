begin;
create extension if not exists pgtap with schema extensions;
-- Start from an app without accounts: the local seed's test account would own it.
delete from auth.users where email = 'prueba@critical.test';
delete from private.app_config where key = 'owner';
select plan(2);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000b1', 'ai@test.local'),
  ('00000000-0000-0000-0000-0000000000b2', 'cal@test.local');
-- The first account owns the app; the second is an invited Google account.
insert into auth.identities (provider_id, user_id, identity_data, provider) values
  ('google-cal', '00000000-0000-0000-0000-0000000000b2', '{"email": "cal@test.local"}', 'google');
insert into public.invites (email) values ('cal@test.local');

set local role service_role;
select public.store_oauth_token('00000000-0000-0000-0000-0000000000b1', 'gemini', 'key-1');
select public.store_oauth_token('00000000-0000-0000-0000-0000000000b2', 'google', 'refresh-1');
select ok(
  not exists (
    select 1 from public.connected_users() u where u = '00000000-0000-0000-0000-0000000000b1'
  ),
  'a Gemini key alone is not a calendar connection'
);
select ok(
  exists (
    select 1 from public.connected_users() u where u = '00000000-0000-0000-0000-0000000000b2'
  ),
  'a Google connection still is'
);

select * from finish();
rollback;

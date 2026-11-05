begin;
create extension if not exists pgtap with schema extensions;
select plan(2);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000b1', 'ai@test.local'),
  ('00000000-0000-0000-0000-0000000000b2', 'cal@test.local');

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

begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000c', 'c@test.local');

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000c"}';
select throws_ok(
  $$ select public.get_oauth_token('00000000-0000-0000-0000-00000000000c', 'google') $$,
  '42501', null, 'users cannot read tokens, not even their own'
);
select throws_ok(
  $$ select public.store_oauth_token('00000000-0000-0000-0000-00000000000c', 'google', 'x') $$,
  '42501', null, 'users cannot write tokens'
);

reset role;
set local role service_role;
select public.store_oauth_token('00000000-0000-0000-0000-00000000000c', 'google', 'secret');
select is(
  public.get_oauth_token('00000000-0000-0000-0000-00000000000c', 'google'),
  'secret',
  'service role round-trips the token'
);

select * from finish();
rollback;

begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000d', 'd@test.local');

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000d"}';
select throws_ok(
  $$ select * from public.google_channels $$,
  '42501', null, 'users cannot read push channels'
);
select throws_ok(
  $$ select public.check_cron_key('x') $$,
  '42501', null, 'users cannot probe the cron key'
);
select throws_ok(
  $$ select public.register_app_url('https://evil.example') $$,
  '42501', null, 'users cannot redirect the cron'
);

reset role;
set local role service_role;
select is(public.check_cron_key('wrong'), false, 'a wrong cron key is rejected');
select ok(
  public.claim_sync('00000000-0000-0000-0000-00000000000d', interval '1 minute'),
  'the first sync is claimed'
);
select ok(
  not public.claim_sync('00000000-0000-0000-0000-00000000000d', interval '1 minute'),
  'a second sync right away is deferred'
);
select ok(
  not public.claim_sync('00000000-0000-0000-0000-00000000000d', interval '0 seconds'),
  'never while another sync of the same user is running'
);
select public.finish_sync('00000000-0000-0000-0000-00000000000d');
select ok(
  public.claim_sync('00000000-0000-0000-0000-00000000000d', interval '1 hour'),
  'a deferred sync is claimed once the running one finished'
);
reset role;
update private.sync_state set running_until = now() - interval '1 second';
set local role service_role;
select ok(
  public.claim_sync('00000000-0000-0000-0000-00000000000d', interval '1 hour') is not null,
  'an expired lease does not block forever'
);

select * from finish();
rollback;

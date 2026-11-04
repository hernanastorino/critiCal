-- Web Push: one row per notification already sent, so a 5-minute cron never repeats one.
create table private.push_log (
  user_id uuid not null references auth.users on delete cascade,
  key text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, key)
);

-- True the first time a notification key is claimed for a user.
create function public.claim_push(p_user uuid, p_key text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare claimed boolean;
begin
  insert into private.push_log (user_id, key) values (p_user, p_key) on conflict do nothing;
  claimed := found;
  if claimed then
    delete from private.push_log where user_id = p_user and sent_at < now() - interval '30 days';
  end if;
  return claimed;
end $$;

revoke execute on function public.claim_push(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_push(uuid, text) to service_role;


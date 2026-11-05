-- Invitation only: the owner (the app's first account) keeps a list of invited emails.
-- Anyone else can sign in with Google but reads and writes nothing, and the server's
-- functions, cron and webhooks skip them.

create table public.invites (
  email text primary key check (email = lower(btrim(email)) and email like '%_@_%'),
  added_at timestamptz not null default now()
);

-- The owner's id lives with the other database settings.
insert into private.app_config (key, value)
select 'owner', id::text from auth.users order by created_at limit 1
on conflict (key) do nothing;

-- Accounts that already exist stay invited.
insert into public.invites (email)
select distinct lower(btrim(email)) from auth.users where email like '%_@_%'
on conflict (email) do nothing;

-- On a database without accounts yet, the first one created becomes the owner, before
-- it can do anything: there is never a moment when access is open to everyone.
create function private.claim_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into private.app_config (key, value) values ('owner', new.id::text)
  on conflict (key) do nothing;
  return new;
end $$;
create trigger first_account_owns_the_app
  after insert on auth.users
  for each row execute function private.claim_owner();

/** Whether a user may use the app: the owner or an invited email. */
create function private.invited(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.app_config where key = 'owner' and value = p_user::text)
    or exists (
      select 1 from auth.users u join public.invites i on i.email = lower(btrim(u.email))
      where u.id = p_user
    );
$$;
revoke execute on function private.invited(uuid) from public, anon, authenticated;

create function public.is_invited()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.invited(auth.uid());
$$;

create function public.is_owner()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from private.app_config where key = 'owner' and value = auth.uid()::text
  );
$$;

/** For the server (service role): the same check for any user. */
create function public.user_invited(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.invited(p_user);
$$;

/** What the app asks after signing in. */
create function public.my_access()
returns json language sql stable security definer set search_path = '' as $$
  select json_build_object(
    'invited', coalesce(private.invited(auth.uid()), false),
    'owner', public.is_owner()
  );
$$;

revoke execute on function public.is_invited() from public, anon;
revoke execute on function public.is_owner() from public, anon;
revoke execute on function public.my_access() from public, anon;
grant execute on function public.is_invited() to authenticated;
grant execute on function public.is_owner() to authenticated;
grant execute on function public.my_access() to authenticated;
revoke execute on function public.user_invited(uuid) from public, anon, authenticated;
grant execute on function public.user_invited(uuid) to service_role;

-- Only the owner sees and edits the list (privileges here, the owner check in RLS).
grant select, insert, update, delete on public.invites to authenticated, service_role;
alter table public.invites enable row level security;
create policy owner_only on public.invites for all to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));

-- Every user table: on top of "own rows", only for invited users.
do $$
declare t text;
begin
  for t in
    select tablename from pg_tables
    where schemaname = 'public' and rowsecurity and tablename <> 'invites'
  loop
    execute format(
      'create policy invited_only on public.%I as restrictive for all to authenticated
         using ((select public.is_invited())) with check ((select public.is_invited()))',
      t
    );
  end loop;
end $$;

-- Background work (cron, Google webhooks, the widget, push) skips users no longer invited.
create or replace function public.connected_users()
returns setof uuid language sql security definer stable set search_path = '' as $$
  select distinct user_id from private.oauth_tokens where private.invited(user_id);
$$;

create or replace function public.widget_user(p_hash text)
returns uuid language sql security definer stable set search_path = '' as $$
  select user_id from private.widget_tokens
  where token_hash = p_hash and private.invited(user_id);
$$;

create or replace function public.claim_sync(p_user uuid, p_gap interval)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not private.invited(p_user) then return false; end if;
  insert into private.sync_state (user_id) values (p_user) on conflict (user_id) do nothing;
  update private.sync_state
    set ran_at = now(), pending = false, running_until = now() + interval '5 minutes'
    where user_id = p_user
      and (running_until is null or running_until < now())
      and (pending or ran_at is null or ran_at < now() - p_gap);
  if found then return true; end if;
  update private.sync_state set pending = true where user_id = p_user;
  return false;
end $$;

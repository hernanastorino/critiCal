-- Calendars from every source, with the role the user gives them. A null role means
-- "guess from the name" (Parciales → parcial, Entregas → entrega, …, else busy).
create table public.calendars (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  source text not null check (source in ('google', 'icloud')),
  external_id text not null,
  name text not null,
  color text,
  role text check (role in ('busy', 'ignore', 'parcial', 'entrega', 'presentacion')),
  primary key (user_id, source, external_id)
);

alter table public.calendars enable row level security;
create policy own_rows on public.calendars for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.calendars to authenticated, service_role;
revoke all on public.calendars from anon;

-- Tasks created from a calendar event wait for a quick confirmation in the inbox.
alter table public.tasks add column needs_review boolean not null default false;

-- Disconnecting a source forgets its credentials.
create function public.delete_oauth_token(p_user uuid, p_provider text)
returns void language plpgsql security definer set search_path = '' as $$
declare sid uuid;
begin
  delete from private.oauth_tokens where user_id = p_user and provider = p_provider
    returning secret_id into sid;
  if sid is not null then
    delete from vault.secrets where id = sid;
  end if;
end $$;

revoke execute on function public.delete_oauth_token(uuid, text) from public, anon, authenticated;
grant execute on function public.delete_oauth_token(uuid, text) to service_role;

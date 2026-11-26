-- Recarga incremental (SPEC §14, «Carga progresiva»): la app trae solo lo que cambió desde la
-- última sincronización. Hace falta saber cuándo cambió cada fila (updated_at, received_at) y
-- qué filas se borraron (lápidas). Todo con la hora del servidor, nunca la del cliente.

-- Cuándo cambió cada fila de las tablas que crecen con los años.
alter table public.plan_blocks add column if not exists updated_at timestamptz not null default now();
alter table public.day_overrides add column if not exists updated_at timestamptz not null default now();
-- Cuándo recibió el servidor cada registro de avance (created_at lo manda el cliente).
alter table public.check_ins add column if not exists received_at timestamptz not null default now();

drop trigger if exists plan_blocks_touch on public.plan_blocks;
create trigger plan_blocks_touch before update on public.plan_blocks
  for each row execute function public.touch_updated_at();
drop trigger if exists day_overrides_touch on public.day_overrides;
create trigger day_overrides_touch before update on public.day_overrides
  for each row execute function public.touch_updated_at();
drop trigger if exists calendar_events_touch on public.calendar_events;
create trigger calendar_events_touch before update on public.calendar_events
  for each row execute function public.touch_updated_at();

create index if not exists plan_blocks_user_updated_idx on public.plan_blocks (user_id, updated_at);
create index if not exists day_overrides_user_updated_idx on public.day_overrides (user_id, updated_at);
create index if not exists calendar_events_user_updated_idx on public.calendar_events (user_id, updated_at);
create index if not exists check_ins_user_received_idx on public.check_ins (user_id, received_at);

-- Lápidas: qué filas se borraron y cuándo, para que otro dispositivo las quite sin volver a
-- bajar todo. Solo guarda la clave de la fila (nada del contenido) y 14 días de historia.
create table if not exists public.deleted_rows (
  -- Con la cuenta se van sus lápidas (nada de ella queda tras borrarla).
  user_id uuid not null references auth.users (id) on delete cascade,
  table_name text not null check (table_name in ('plan_blocks', 'calendar_events', 'day_overrides')),
  row_key text not null,
  deleted_at timestamptz not null default now()
);
create index if not exists deleted_rows_user_deleted_idx on public.deleted_rows (user_id, deleted_at);

alter table public.deleted_rows enable row level security;
drop policy if exists own_select on public.deleted_rows;
create policy own_select on public.deleted_rows for select to authenticated
  using (user_id = (select auth.uid()));
-- Nadie escribe a mano: solo el trigger (security definer).
revoke all on public.deleted_rows from anon, authenticated;
grant select on public.deleted_rows to authenticated;

create or replace function public.record_deleted_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v jsonb := to_jsonb(old);
  k text;
begin
  -- Borrando la cuenta (cascada desde auth.users) no se deja nada de ella.
  if not exists (select 1 from auth.users u where u.id = old.user_id) then
    return old;
  end if;
  k := case tg_table_name
    when 'plan_blocks' then v ->> 'id'
    when 'calendar_events' then (v ->> 'source') || ':' || (v ->> 'external_id')
    else v ->> 'date'
  end;
  insert into public.deleted_rows (user_id, table_name, row_key)
  values (old.user_id, tg_table_name, k);
  return old;
end $$;
revoke all on function public.record_deleted_row() from public, anon, authenticated;

-- La poda, una vez por sentencia (un replan borra decenas de bloques de golpe): más viejas
-- que 14 días se van, solo las de los usuarios que acaban de borrar algo. Un dispositivo que
-- estuvo más tiempo sin abrirse carga todo.
create or replace function public.prune_deleted_rows() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.deleted_rows d
  where d.deleted_at < now() - interval '14 days'
    and d.user_id in (select distinct r.user_id from removed r);
  return null;
end $$;
revoke all on function public.prune_deleted_rows() from public, anon, authenticated;

drop trigger if exists plan_blocks_deleted on public.plan_blocks;
create trigger plan_blocks_deleted after delete on public.plan_blocks
  for each row execute function public.record_deleted_row();
drop trigger if exists calendar_events_deleted on public.calendar_events;
create trigger calendar_events_deleted after delete on public.calendar_events
  for each row execute function public.record_deleted_row();
drop trigger if exists day_overrides_deleted on public.day_overrides;
create trigger day_overrides_deleted after delete on public.day_overrides
  for each row execute function public.record_deleted_row();

drop trigger if exists plan_blocks_pruned on public.plan_blocks;
create trigger plan_blocks_pruned after delete on public.plan_blocks
  referencing old table as removed for each statement execute function public.prune_deleted_rows();
drop trigger if exists calendar_events_pruned on public.calendar_events;
create trigger calendar_events_pruned after delete on public.calendar_events
  referencing old table as removed for each statement execute function public.prune_deleted_rows();
drop trigger if exists day_overrides_pruned on public.day_overrides;
create trigger day_overrides_pruned after delete on public.day_overrides
  referencing old table as removed for each statement execute function public.prune_deleted_rows();

-- La hora del servidor: la marca de la próxima recarga (nunca el reloj del dispositivo).
create or replace function public.server_now() returns timestamptz
language sql stable set search_path = '' as $$ select pg_catalog.now() $$;
revoke all on function public.server_now() from public, anon;
grant execute on function public.server_now() to authenticated;

begin;
create extension if not exists pgtap with schema extensions;
delete from auth.users where email = 'prueba@critical.test';
delete from private.app_config where key = 'owner';
select plan(19);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'e1@test.local'),
  ('00000000-0000-0000-0000-0000000000e2', 'e2@test.local');

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000e1"}';

insert into public.activities (id, name, color, academic)
values ('00000000-0000-0000-0000-00000000a001', 'Física', '#fff', true);
insert into public.tasks (id, activity_id, title, kind, priority, status)
values ('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-00000000a001',
        'Parcial', 'deliverable', 1, 'active');
insert into public.plan_blocks (id, task_id, start_at, end_at, level, soft)
values ('blk-1', '00000000-0000-0000-0000-00000000b001', '2026-11-25 10:00+00', '2026-11-25 11:00+00', 'ok', false),
       ('blk-2', '00000000-0000-0000-0000-00000000b001', '2026-11-26 10:00+00', '2026-11-26 11:00+00', 'ok', false);
insert into public.calendar_events (source, external_id, title, start_at, end_at, busy, all_day)
values ('google', 'ev-1', 'Clase', '2026-11-25 12:00+00', '2026-11-25 13:00+00', true, false);
insert into public.day_overrides (date, wake, bed) values ('2026-11-25', 420, 1380);

-- La hora del servidor.
select ok((select public.server_now()) between now() - interval '1 minute' and now() + interval '1 minute',
  'server_now is the server clock');

-- Un registro de avance lleva la hora en que lo recibió el servidor, aunque el cliente mande otra.
insert into public.check_ins (block_id, task_id, status, created_at)
values ('blk-1', '00000000-0000-0000-0000-00000000b001', 'done', '2020-01-01 00:00+00');
select ok((select received_at from public.check_ins where block_id = 'blk-1') > now() - interval '1 minute',
  'received_at is stamped by the server');

-- updated_at se mueve con cada UPDATE (se fuerza atrás para verlo).
reset role;
update public.plan_blocks set updated_at = '2020-01-01' where id = 'blk-1';
update public.calendar_events set updated_at = '2020-01-01' where external_id = 'ev-1';
update public.day_overrides set updated_at = '2020-01-01' where date = '2026-11-25';
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000e1"}';
update public.plan_blocks set soft = true where id = 'blk-1';
update public.calendar_events set title = 'Clase 2' where external_id = 'ev-1';
update public.day_overrides set wake = 430 where date = '2026-11-25';
select ok((select updated_at from public.plan_blocks where id = 'blk-1') > now() - interval '1 minute', 'a block touches updated_at');
select ok((select updated_at from public.calendar_events where external_id = 'ev-1') > now() - interval '1 minute', 'an event touches updated_at');
select ok((select updated_at from public.day_overrides where date = '2026-11-25') > now() - interval '1 minute', 'an override touches updated_at');

-- Borrar deja una lápida con la clave de la fila.
delete from public.plan_blocks where id = 'blk-1';
delete from public.calendar_events where external_id = 'ev-1';
delete from public.day_overrides where date = '2026-11-25';
select is((select row_key from public.deleted_rows where table_name = 'plan_blocks'), 'blk-1', 'a deleted block leaves its id');
select is((select row_key from public.deleted_rows where table_name = 'calendar_events'), 'google:ev-1', 'a deleted event leaves source:external_id');
select is((select row_key from public.deleted_rows where table_name = 'day_overrides'), '2026-11-25', 'a deleted override leaves its date');

-- También por cascada (se borra la tarea y se van sus bloques).
reset role;
delete from public.check_ins;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000e1"}';
delete from public.tasks where id = '00000000-0000-0000-0000-00000000b001';
select is((select count(*)::int from public.deleted_rows where row_key = 'blk-2'), 1, 'a cascade leaves tombstones too');

-- Nadie escribe ni borra lápidas a mano.
select throws_ok($$ insert into public.deleted_rows (user_id, table_name, row_key)
  values ('00000000-0000-0000-0000-0000000000e1', 'plan_blocks', 'x') $$, '42501', null, 'no direct insert');
select throws_ok($$ delete from public.deleted_rows $$, '42501', null, 'no direct delete');

-- Otro usuario no ve las lápidas.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000e2"}';
select is((select count(*)::int from public.deleted_rows), 0, 'others do not see tombstones');

-- La poda: borrar algo de e2 no toca las lápidas viejas de e1, y borra las viejas de e2 solo.
reset role;
insert into public.deleted_rows (user_id, table_name, row_key, deleted_at) values
  ('00000000-0000-0000-0000-0000000000e1', 'plan_blocks', 'viejo-e1', now() - interval '20 days'),
  ('00000000-0000-0000-0000-0000000000e2', 'plan_blocks', 'viejo-e2', now() - interval '20 days');
insert into public.day_overrides (user_id, date, wake, bed)
values ('00000000-0000-0000-0000-0000000000e2', '2026-12-01', 420, 1380);
delete from public.day_overrides where date = '2026-12-01';
select is((select count(*)::int from public.deleted_rows where row_key = 'viejo-e2'), 0, 'the user''s own old tombstones are pruned');
select is((select count(*)::int from public.deleted_rows where row_key = 'viejo-e1'), 1, 'other users'' tombstones are left alone');
select is((select count(*)::int from public.deleted_rows where row_key = '2026-12-01'), 1, 'the fresh tombstone stays');
-- Las columnas e índices existen una sola vez (la migración se puede repetir).
select has_index('public', 'deleted_rows', 'deleted_rows_user_deleted_idx', 'tombstones are pruned by an index');

-- Borrar una cuenta no deja nada suyo: ni lápidas de antes ni las que haría la cascada, y no falla.
reset role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000e3', 'e3@test.local');
insert into public.activities (user_id, id, name, color, academic)
values ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-00000000a003', 'Q', '#fff', true);
insert into public.tasks (user_id, id, activity_id, title, kind, priority, status)
values ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-00000000b003',
        '00000000-0000-0000-0000-00000000a003', 'T', 'deliverable', 1, 'active');
insert into public.plan_blocks (user_id, id, task_id, start_at, end_at, level, soft)
values ('00000000-0000-0000-0000-0000000000e3', 'e3-blk', '00000000-0000-0000-0000-00000000b003',
        '2026-11-25 10:00+00', '2026-11-25 11:00+00', 'ok', false);
insert into public.calendar_events (user_id, source, external_id, title, start_at, end_at, busy, all_day)
values ('00000000-0000-0000-0000-0000000000e3', 'google', 'e3-ev', 'X', '2026-11-25 12:00+00', '2026-11-25 13:00+00', true, false);
insert into public.day_overrides (user_id, date, wake, bed)
values ('00000000-0000-0000-0000-0000000000e3', '2026-11-25', 420, 1380);
-- Como «Revocar conexiones»: los eventos se borran con la cuenta todavía viva.
delete from public.calendar_events where user_id = '00000000-0000-0000-0000-0000000000e3';
select is((select count(*)::int from public.deleted_rows where user_id = '00000000-0000-0000-0000-0000000000e3'), 1,
  'revoking connections leaves a tombstone while the account lives');
select lives_ok($$ delete from auth.users where id = '00000000-0000-0000-0000-0000000000e3' $$,
  'deleting an account does not fail on its tombstones');
select is((select count(*)::int from public.deleted_rows where user_id = '00000000-0000-0000-0000-0000000000e3'), 0,
  'nothing of a deleted account is left in deleted_rows');

select * from finish();
rollback;

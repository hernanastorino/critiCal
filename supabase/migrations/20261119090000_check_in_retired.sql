-- Deshacer un registro (SPEC §3: el registro solo crece). Los usuarios no pueden borrar
-- check-ins, así que deshacer el primer registro de un bloque agrega uno nuevo con estado
-- «retired»: la app lo trata como «sin registro». Deshacer una corrección agrega una copia
-- del registro anterior (no necesita un valor nuevo).
alter table public.check_ins drop constraint check_ins_status_check;
alter table public.check_ins
  add constraint check_ins_status_check
  check (status in ('done', 'missed', 'partial', 'retired'));

-- «Dormías» (SPEC «El pasado no se recalcula»): al decir a qué hora me levanté, los bloques de
-- hoy anteriores a esa hora que no tienen registro se cierran como «no hecho» con un registro
-- nuevo. Es un registro más (el log solo crece); su origen lo dice.
alter table public.check_ins drop constraint check_ins_origin_check;
alter table public.check_ins
  add constraint check_ins_origin_check check (origin in ('undo', 'slept'));

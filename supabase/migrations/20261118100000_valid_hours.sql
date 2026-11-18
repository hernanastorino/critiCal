-- Horario válido de una rutina (SPEC §5): el plan la ubica solo dentro de su franja de
-- cada día. `{ "all": {start,end}, "days": { "6": {start,end} } }`, en minutos desde la
-- medianoche; el día de la semana 0 es domingo. Vacío: a cualquier hora.
alter table public.activities
  add column valid_hours jsonb
  check (
    valid_hours is null
    or (jsonb_typeof(valid_hours) = 'object' and pg_column_size(valid_hours) <= 1024)
  );

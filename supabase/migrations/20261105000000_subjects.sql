-- Materias come from the class schedule (a calendar with the role "clases"); routines
-- such as the gym are activities of their own kind, never called a materia.
alter table public.activities
  add column kind text check (kind in ('materia', 'rutina')),
  -- Other names a materia goes by in events ("ADD" for "Análisis y Diseño de Datos").
  add column aliases text[] not null default '{}';

alter table public.calendars drop constraint calendars_role_check;
alter table public.calendars add constraint calendars_role_check
  check (role in ('busy', 'ignore', 'parcial', 'entrega', 'presentacion', 'clases'));

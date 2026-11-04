-- Materias come from the class schedule (a calendar with the role "clases"); routines
-- such as the gym are activities of their own kind, never called a materia.
alter table public.activities
  add column kind text check (kind in ('materia', 'rutina')),
  -- Other names a materia goes by in events ("ADD" for "Análisis y Diseño de Datos").
  add column aliases text[] not null default '{}';

alter table public.calendars drop constraint calendars_role_check;
alter table public.calendars add constraint calendars_role_check
  check (role in ('busy', 'ignore', 'parcial', 'entrega', 'presentacion', 'clases'));

-- A materia's weekly study silo, told apart from its other habits by this mark rather
-- than by its title (titles can be renamed or repeated).
alter table public.tasks add column study boolean not null default false;
-- At most one per materia: the oldest active habit with its title.
update public.tasks set study = true
  where id in (
    select distinct on (t.activity_id) t.id
    from public.tasks t
    join public.activities a on a.id = t.activity_id
    where t.kind = 'habit' and t.status = 'active' and t.title = 'Estudio ' || a.name
    order by t.activity_id, t.created_at, t.id
  );

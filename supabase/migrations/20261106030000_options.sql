-- More ways out when the minimums do not fit: units weigh in the exam and can be left
-- out, and calendars can hold events that may be moved.
alter table public.task_units
  add column weight int check (weight between 0 and 100),
  add column skipped boolean not null default false;

alter table public.calendars drop constraint calendars_role_check;
alter table public.calendars add constraint calendars_role_check
  check (role in ('busy', 'ignore', 'parcial', 'entrega', 'presentacion', 'clases', 'flexible'));

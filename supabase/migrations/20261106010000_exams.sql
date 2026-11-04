-- Exams get spaced review sessions before their date, and may keep the day before for
-- their materia alone.
alter table public.tasks
  add column exam boolean not null default false,
  add column day_before_only boolean not null default false;

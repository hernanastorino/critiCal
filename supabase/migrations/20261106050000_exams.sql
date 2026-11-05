-- Exams get spaced review sessions before their date, and may keep the day before for
-- their materia alone.
alter table public.tasks
  add column exam boolean not null default false,
  add column day_before_only boolean not null default false,
  -- What the calendar event was imported as: only a change of it re-decides `exam`.
  add column source_role text check (source_role in ('parcial', 'entrega', 'presentacion'));

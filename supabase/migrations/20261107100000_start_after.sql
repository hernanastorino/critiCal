-- «Puedo empezar» (§18.7) of a task and of a materia: a date, days before the deadline,
-- or right away. Kept as the app's own small JSON.
alter table public.tasks add column start_after jsonb;
alter table public.activities add column start_after jsonb;

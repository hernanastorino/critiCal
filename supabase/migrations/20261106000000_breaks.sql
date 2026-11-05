-- Study sessions with a break after each (50 + 10 by default for materias): the break
-- is not drawn, it is part of the block's time, so planned blocks cover study + rest.
alter table public.activities
  add column study_minutes int check (study_minutes > 0),
  add column break_minutes int check (break_minutes >= 0);

-- Each check-in keeps the factor it was recorded with, so changing a materia's breaks
-- later does not rewrite how much was already studied. Null: no breaks (older rows).
alter table public.check_ins
  add column block_factor numeric check (block_factor >= 1);

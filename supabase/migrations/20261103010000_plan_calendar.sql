-- The one Google calendar the app writes the plan into, so it is never created twice.
alter table public.settings alter column data set default '{}';
alter table public.settings add column google_plan_calendar text;

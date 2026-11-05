-- A task the calendar import dropped (its event lost the tag or calendar role) keeps
-- when; equal to ended_at, nobody touched it since and it returns with its event.
alter table public.tasks add column auto_dropped_at timestamptz;

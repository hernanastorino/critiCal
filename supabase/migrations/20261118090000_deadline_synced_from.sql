-- A silo that follows a calendar event keeps the deadline the user typed: this is the
-- deadline the event gave it, which the user's date replaced. The import follows the event
-- again once the event moves off this value.
alter table public.tasks add column deadline_synced_from timestamptz;

-- Hosted Supabase no longer grants API roles access to new tables automatically.
-- RLS still decides which rows each user sees; these grants only open the tables.
grant select, insert, update, delete on
  public.settings, public.activities, public.tasks, public.task_units, public.plan_blocks,
  public.calendar_events, public.day_overrides, public.places, public.travel_times,
  public.proposals, public.push_subscriptions
  to authenticated, service_role;

-- Check-ins are append-only for users.
grant select, insert on public.check_ins to authenticated;
grant select, insert, update, delete on public.check_ins to service_role;
revoke update, delete, truncate on public.check_ins from authenticated;

-- Signed-out visitors get nothing (older projects granted anon by default).
revoke all on
  public.settings, public.activities, public.tasks, public.task_units, public.check_ins,
  public.plan_blocks, public.calendar_events, public.day_overrides, public.places,
  public.travel_times, public.proposals, public.push_subscriptions
  from anon;

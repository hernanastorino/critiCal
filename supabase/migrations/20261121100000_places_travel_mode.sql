-- Bus trips (SPEC §15), interface: each saved place says how to get there by default,
-- by car (the driving times) or by bus (the schedules of /api/transit). A trip can
-- still be changed just that once from the app (kept in the user's settings state).
alter table public.places
  add column travel_mode text not null default 'car' check (travel_mode in ('car', 'bus'));

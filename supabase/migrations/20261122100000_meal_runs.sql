-- The past is not planned again (SPEC §5): where and when each meal was, once the day is
-- over. One series per meal and weekday (4 × 7 per user); a series is a list of runs,
-- each saying "from this date on, this meal was at this time" until the next run opens.
create table public.meal_runs (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  -- desayuno, almuerzo, merienda, cena.
  meal text not null check (meal in ('desayuno', 'almuerzo', 'merienda', 'cena')),
  -- 0 = Sunday … 6 = Saturday.
  weekday smallint not null check (weekday between 0 and 6),
  from_date date not null,
  -- Last day of the run; null while it is the one standing.
  to_date date,
  -- Minutes since the logical day's midnight.
  start_minutes int not null check (start_minutes between 0 and 2880),
  end_minutes int not null check (end_minutes between 0 and 2880),
  place_id uuid references public.places on delete set null,
  primary key (user_id, meal, weekday, from_date),
  check (to_date is null or to_date >= from_date),
  check (end_minutes >= start_minutes)
);
alter table public.meal_runs enable row level security;
create policy own_rows on public.meal_runs for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.meal_runs to authenticated, service_role;
revoke all on public.meal_runs from anon;

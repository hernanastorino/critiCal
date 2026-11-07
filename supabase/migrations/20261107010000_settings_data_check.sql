-- settings.data is written straight from the browser: refuse what the app could never
-- have written (a week of 3 days, «maxActivitiesPerDay» as text, a megabyte of junk).
-- A trigger, not a CHECK: it only looks at rows being inserted or whose data changes, so
-- an old row that does not comply is left alone and its other columns (e.g.
-- google_plan_calendar) can still be updated. Every key is optional: the app fills in
-- the defaults of what is missing.
create function private.settings_data_valid(d jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select
    jsonb_typeof(d) = 'object'
    and octet_length(d::text) <= 65536
    and case when d ? 'timezone' then jsonb_typeof(d -> 'timezone') = 'string'
             and length(d ->> 'timezone') between 1 and 64 else true end
    and case when d ? 'week' then jsonb_typeof(d -> 'week') = 'array'
             and jsonb_array_length(d -> 'week') = 7 else true end
    and case when d ? 'slotMinutes' then jsonb_typeof(d -> 'slotMinutes') = 'number'
             and (d ->> 'slotMinutes')::numeric between 1 and 1440 else true end
    and case when d ? 'travelMarginMinutes' then jsonb_typeof(d -> 'travelMarginMinutes') = 'number'
             and (d ->> 'travelMarginMinutes')::numeric between 0 and 1440 else true end
    and case when d ? 'maxActivitiesPerDay' then jsonb_typeof(d -> 'maxActivitiesPerDay') = 'number'
             and (d ->> 'maxActivitiesPerDay')::numeric between 1 and 50 else true end
    and case when d ? 'warnSlackMinutes' then jsonb_typeof(d -> 'warnSlackMinutes') = 'number'
             and (d ->> 'warnSlackMinutes')::numeric between 0 and 10080 else true end
$$;

-- Security definer: the writer (the browser's role) cannot reach the private schema.
create function private.check_settings_data() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (tg_op = 'INSERT' or new.data is distinct from old.data)
     and not private.settings_data_valid(new.data) then
    raise exception 'invalid settings data' using errcode = '22023';
  end if;
  return new;
end $$;

create trigger settings_data_check before insert or update on public.settings
  for each row execute function private.check_settings_data();

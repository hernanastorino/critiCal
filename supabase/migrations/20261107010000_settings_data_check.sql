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
    -- The type test sits in the CASE condition, so a cast never runs on a non-number.
    and case when not d ? 'timezone' then true
             when jsonb_typeof(d -> 'timezone') <> 'string' then false
             else length(d ->> 'timezone') between 1 and 64 end
    and case when not d ? 'week' then true
             when jsonb_typeof(d -> 'week') <> 'array' then false
             else jsonb_array_length(d -> 'week') = 7
               and not exists (
                 select 1 from jsonb_array_elements(d -> 'week') e where jsonb_typeof(e) <> 'object'
               ) end
    and case when not d ? 'slotMinutes' then true
             when jsonb_typeof(d -> 'slotMinutes') <> 'number' then false
             else (d ->> 'slotMinutes')::numeric between 1 and 1440 end
    and case when not d ? 'travelMarginMinutes' then true
             when jsonb_typeof(d -> 'travelMarginMinutes') <> 'number' then false
             else (d ->> 'travelMarginMinutes')::numeric between 0 and 1440 end
    and case when not d ? 'maxActivitiesPerDay' then true
             when jsonb_typeof(d -> 'maxActivitiesPerDay') <> 'number' then false
             else (d ->> 'maxActivitiesPerDay')::numeric between 1 and 50 end
    and case when not d ? 'warnSlackMinutes' then true
             when jsonb_typeof(d -> 'warnSlackMinutes') <> 'number' then false
             else (d ->> 'warnSlackMinutes')::numeric between 0 and 10080 end
$$;

-- Security definer: the writer (the browser's role) cannot reach the private schema.
create function private.check_settings_data() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- The app saves with an upsert, which fires this as an insert even when the row is
  -- there: data that is already stored as it is (a legacy row) is let through.
  if (tg_op = 'INSERT' or new.data is distinct from old.data)
     and not private.settings_data_valid(new.data)
     and not exists (
       select 1 from public.settings s where s.user_id = new.user_id and s.data = new.data
     ) then
    raise exception 'invalid settings data' using errcode = '22023';
  end if;
  return new;
end $$;

create trigger settings_data_check before insert or update on public.settings
  for each row execute function private.check_settings_data();

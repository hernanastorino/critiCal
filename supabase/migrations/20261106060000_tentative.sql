-- Tentative events (Google "tentative", iCloud STATUS:TENTATIVE): the plan counts on
-- them, and proposes a plan B for the day if one falls through.
alter table public.calendar_events add column tentative boolean not null default false;

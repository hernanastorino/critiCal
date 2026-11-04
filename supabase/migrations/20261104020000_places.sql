-- Saved places get an address, geocoded once (OpenStreetMap) for automatic driving times.
alter table public.places add column address text;

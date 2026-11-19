-- Parts done by hand vs parts a record declares (SPEC §3). A part is done when it was marked
-- by hand or when the record that stands for some block declares it; the app no longer
-- guesses which one it was by comparing dates.
alter table public.task_units
  add column done_by_hand boolean not null default false;

-- The rows that exist: a done part that no standing record declares was marked by hand. The
-- record that stands for a block is its newest one (by date, then id), unless it is «retired».
update public.task_units u
set done_by_hand = true
where u.done_at is not null
  and not exists (
    select 1
    from public.check_ins c
    where c.task_id = u.task_id
      and c.user_id = u.user_id
      and c.status <> 'retired'
      and u.id = any (c.unit_ids)
      and not exists (
        select 1
        from public.check_ins newer
        where newer.user_id = c.user_id
          and newer.block_id = c.block_id
          and (newer.created_at, newer.id) > (c.created_at, c.id)
      )
  );

-- «Deshacer» writes a copy of the earlier answer (or a «retired» one): it says so, instead of
-- the app guessing from the content that it is not a new answer.
alter table public.check_ins
  add column origin text check (origin in ('undo'));

update public.check_ins set origin = 'undo' where status = 'retired';

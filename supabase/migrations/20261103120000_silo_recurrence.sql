-- Weekly silos can skip a week, pause until resumed, or stop repeating from a date.
alter table public.tasks
  add column skip_until timestamptz,
  add column paused boolean not null default false,
  add column ended_at timestamptz;

-- Deleting a silo entirely takes its check-ins with it. Check-ins stay
-- append-only for users: only the cascade (run as the table owner) removes them.
alter table public.check_ins drop constraint check_ins_task_id_user_id_fkey;
alter table public.check_ins
  add constraint check_ins_task_id_user_id_fkey
  foreign key (task_id, user_id) references public.tasks (id, user_id) on delete cascade;

-- Repaso espaciado (SPEC): el motor marca los bloques que caen 7, 3 y 1 días antes de un parcial.
alter table public.plan_blocks add column review boolean not null default false;

-- Initial schema only. Player identity/session tables and command RPCs are deliberately
-- deferred until their threat model and auth flow are implemented.
create extension if not exists pgcrypto;

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  host_display_name text not null check (char_length(host_display_name) between 2 and 24),
  status text not null default 'lobby' check (status in ('lobby', 'in_progress', 'finished')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.rooms enable row level security;

-- No anon/authenticated policies yet: direct client access is denied by default.
-- All access must go through a future authenticated, validated server command layer.
revoke all on public.rooms from anon, authenticated;
grant select, insert, update, delete on public.rooms to service_role;

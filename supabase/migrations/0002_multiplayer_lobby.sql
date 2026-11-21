create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 24),
  session_token_hash text not null unique,
  is_host boolean not null default false,
  is_ready boolean not null default false,
  joined_at timestamptz not null default now()
);

create unique index if not exists players_room_display_name_unique
  on public.players (room_id, lower(display_name));

create index if not exists players_room_joined_at_idx
  on public.players (room_id, joined_at);

alter table public.players enable row level security;
revoke all on public.players from anon, authenticated;
grant select, insert, update, delete on public.players to service_role;

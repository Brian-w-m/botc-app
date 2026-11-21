alter table public.players
  add column if not exists session_expires_at timestamptz not null default (now() + interval '7 days'),
  add column if not exists session_revoked_at timestamptz;

create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null unique references public.rooms(id) on delete cascade,
  ruleset_id text not null,
  ruleset_version text not null,
  phase text not null check (phase in ('setup', 'night', 'day', 'finished')),
  day_number integer not null default 0 check (day_number >= 0),
  version integer not null default 0 check (version >= 0),
  public_state jsonb not null default '{}'::jsonb,
  secret_state jsonb not null default '{}'::jsonb,
  random_seed text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists public.game_events (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  command_id uuid not null,
  version integer not null,
  actor_player_id uuid references public.players(id) on delete set null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (game_id, command_id),
  unique (game_id, version)
);

create index if not exists game_events_game_created_idx
  on public.game_events (game_id, created_at);

create table if not exists public.rate_limit_buckets (
  bucket_key text not null,
  window_start timestamptz not null,
  request_count integer not null check (request_count > 0),
  primary key (bucket_key, window_start)
);

alter table public.games enable row level security;
alter table public.game_events enable row level security;
alter table public.rate_limit_buckets enable row level security;
revoke all on public.games, public.game_events, public.rate_limit_buckets from anon, authenticated;
grant select, insert, update, delete on public.games, public.game_events, public.rate_limit_buckets to service_role;

create or replace function public.commit_game_command(
  p_game_id uuid,
  p_command_id uuid,
  p_expected_version integer,
  p_actor_player_id uuid,
  p_next_phase text,
  p_next_day_number integer,
  p_public_state jsonb,
  p_secret_state jsonb,
  p_event_type text,
  p_event_payload jsonb
)
returns table (accepted boolean, current_version integer, duplicate boolean)
language plpgsql
set search_path = public
as $$
declare
  new_version integer;
begin
  if exists (
    select 1 from public.game_events e
    where e.game_id = p_game_id and e.command_id = p_command_id
  ) then
    select g.version into current_version from public.games g where g.id = p_game_id;
    return query select true, current_version, true;
    return;
  end if;

  update public.games g
  set phase = p_next_phase,
      day_number = p_next_day_number,
      public_state = p_public_state,
      secret_state = p_secret_state,
      version = g.version + 1,
      updated_at = now(),
      finished_at = case when p_next_phase = 'finished' then coalesce(g.finished_at, now()) else g.finished_at end
  where g.id = p_game_id and g.version = p_expected_version
  returning g.version into new_version;

  if new_version is null then
    if exists (
      select 1 from public.game_events e
      where e.game_id = p_game_id and e.command_id = p_command_id
    ) then
      select g.version into current_version from public.games g where g.id = p_game_id;
      return query select true, current_version, true;
      return;
    end if;
    select g.version into current_version from public.games g where g.id = p_game_id;
    return query select false, current_version, false;
    return;
  end if;

  insert into public.game_events(game_id, command_id, version, actor_player_id, event_type, payload)
  values (p_game_id, p_command_id, new_version, p_actor_player_id, p_event_type, p_event_payload);

  if p_next_phase = 'finished' then
    update public.rooms r set status = 'finished', updated_at = now()
    where r.id = (select g.room_id from public.games g where g.id = p_game_id);
  end if;

  return query select true, new_version, false;
end;
$$;

revoke all on function public.commit_game_command(uuid, uuid, integer, uuid, text, integer, jsonb, jsonb, text, jsonb) from public, anon, authenticated;
grant execute on function public.commit_game_command(uuid, uuid, integer, uuid, text, integer, jsonb, jsonb, text, jsonb) to service_role;

create or replace function public.consume_rate_limit(
  p_bucket_key text,
  p_limit integer,
  p_window_seconds integer
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
set search_path = public
as $$
declare
  bucket_start timestamptz;
  current_count integer;
begin
  if p_limit < 1 or p_window_seconds < 1 then
    raise exception 'Rate limit and window must be positive';
  end if;

  bucket_start := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds
  );

  insert into public.rate_limit_buckets as b(bucket_key, window_start, request_count)
  values (p_bucket_key, bucket_start, 1)
  on conflict (bucket_key, window_start)
  do update set request_count = b.request_count + 1
  returning request_count into current_count;

  delete from public.rate_limit_buckets b
  where b.window_start < now() - interval '2 days';

  return query select
    current_count <= p_limit,
    greatest(1, ceil(extract(epoch from (bucket_start + make_interval(secs => p_window_seconds) - clock_timestamp())))::integer);
end;
$$;

revoke all on function public.consume_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;

create or replace function public.leave_room_lobby(
  p_room_id uuid,
  p_player_id uuid
)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  room_status text;
  player_is_host boolean;
  successor_id uuid;
begin
  select r.status, p.is_host into room_status, player_is_host
  from public.rooms r
  join public.players p on p.room_id = r.id
  where r.id = p_room_id and p.id = p_player_id
  for update of r, p;

  if room_status is distinct from 'lobby' then
    return false;
  end if;

  if player_is_host then
    select p.id into successor_id
    from public.players p
    where p.room_id = p_room_id and p.id <> p_player_id
    order by p.joined_at, p.id
    limit 1
    for update;

    if successor_id is not null then
      update public.players set is_host = true where id = successor_id;
    end if;
  end if;

  delete from public.players where id = p_player_id and room_id = p_room_id;
  if not exists (select 1 from public.players p where p.room_id = p_room_id) then
    delete from public.rooms where id = p_room_id;
  end if;
  return true;
end;
$$;

revoke all on function public.leave_room_lobby(uuid, uuid) from public, anon, authenticated;
grant execute on function public.leave_room_lobby(uuid, uuid) to service_role;

create or replace function public.join_room_lobby(
  p_room_id uuid,
  p_display_name text,
  p_session_token_hash text,
  p_session_expires_at timestamptz
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  room_status text;
  new_player_id uuid;
begin
  select r.status into room_status
  from public.rooms r
  where r.id = p_room_id
  for update;

  if room_status is distinct from 'lobby' then
    raise exception using errcode = 'P0001', message = 'ROOM_NOT_JOINABLE';
  end if;

  insert into public.players(room_id, display_name, session_token_hash, session_expires_at)
  values (p_room_id, p_display_name, p_session_token_hash, p_session_expires_at)
  returning id into new_player_id;

  return new_player_id;
end;
$$;

revoke all on function public.join_room_lobby(uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.join_room_lobby(uuid, text, text, timestamptz) to service_role;

create or replace function public.start_room_game(
  p_room_id uuid,
  p_actor_player_id uuid,
  p_command_id uuid,
  p_ruleset_id text,
  p_ruleset_version text,
  p_min_players integer,
  p_max_players integer,
  p_phase text,
  p_day_number integer,
  p_public_state jsonb,
  p_secret_state jsonb,
  p_random_seed text
)
returns table (game_id uuid, game_version integer, duplicate boolean)
language plpgsql
set search_path = public
as $$
declare
  room_status text;
  actor_is_host boolean;
  player_count integer;
  existing_game_id uuid;
  new_game_id uuid;
begin
  select g.id into existing_game_id
  from public.games g
  where g.room_id = p_room_id;

  if existing_game_id is not null then
    if exists (
      select 1 from public.game_events e
      where e.game_id = existing_game_id and e.command_id = p_command_id
    ) then
      return query select existing_game_id, g.version, true
      from public.games g where g.id = existing_game_id;
      return;
    end if;
    raise exception using errcode = 'P0001', message = 'GAME_ALREADY_STARTED';
  end if;

  select r.status into room_status
  from public.rooms r where r.id = p_room_id for update;

  select g.id into existing_game_id
  from public.games g
  where g.room_id = p_room_id;
  if existing_game_id is not null then
    if exists (
      select 1 from public.game_events e
      where e.game_id = existing_game_id and e.command_id = p_command_id
    ) then
      return query select existing_game_id, g.version, true
      from public.games g where g.id = existing_game_id;
      return;
    end if;
    raise exception using errcode = 'P0001', message = 'GAME_ALREADY_STARTED';
  end if;

  if room_status is distinct from 'lobby' then
    raise exception using errcode = 'P0001', message = 'ROOM_NOT_IN_LOBBY';
  end if;

  select p.is_host into actor_is_host
  from public.players p
  where p.id = p_actor_player_id and p.room_id = p_room_id
    and p.session_revoked_at is null and p.session_expires_at > now();
  if actor_is_host is distinct from true then
    raise exception using errcode = '42501', message = 'HOST_REQUIRED';
  end if;

  select count(*)::integer into player_count
  from public.players p
  where p.room_id = p_room_id and p.session_revoked_at is null and p.session_expires_at > now();
  if player_count < p_min_players then
    raise exception using errcode = 'P0001', message = 'NOT_ENOUGH_PLAYERS';
  end if;
  if player_count > p_max_players then
    raise exception using errcode = 'P0001', message = 'TOO_MANY_PLAYERS';
  end if;

  insert into public.games(
    room_id, ruleset_id, ruleset_version, phase, day_number, version,
    public_state, secret_state, random_seed
  ) values (
    p_room_id, p_ruleset_id, p_ruleset_version, p_phase, p_day_number, 1,
    p_public_state, p_secret_state, p_random_seed
  ) returning id into new_game_id;

  insert into public.game_events(game_id, command_id, version, actor_player_id, event_type, payload)
  values (
    new_game_id, p_command_id, 1, p_actor_player_id, 'GAME_STARTED',
    jsonb_build_object('public', jsonb_build_object('phase', p_phase, 'dayNumber', p_day_number))
  );

  update public.rooms set status = 'in_progress', updated_at = now() where id = p_room_id;
  return query select new_game_id, 1, false;
end;
$$;

revoke all on function public.start_room_game(uuid, uuid, uuid, text, text, integer, integer, text, integer, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.start_room_game(uuid, uuid, uuid, text, text, integer, integer, text, integer, jsonb, jsonb, text) to service_role;

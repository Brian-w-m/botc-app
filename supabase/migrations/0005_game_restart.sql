-- Bots have no player session, so keep their seats active for the room's lifetime.
alter table public.players alter column session_expires_at set default 'infinity'::timestamptz;
update public.players set session_expires_at = 'infinity'::timestamptz where is_bot;

create or replace function public.restart_room_game(
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
  current_version integer;
  new_version integer;
begin
  select r.status into room_status from public.rooms r where r.id = p_room_id for update;
  select g.id, g.version into existing_game_id, current_version
  from public.games g where g.room_id = p_room_id for update;
  if existing_game_id is null then
    raise exception using errcode = 'P0001', message = 'GAME_NOT_FOUND';
  end if;

  if exists (select 1 from public.game_events e where e.game_id = existing_game_id and e.command_id = p_command_id) then
    return query select existing_game_id, current_version, true;
    return;
  end if;

  select p.is_host into actor_is_host
  from public.players p
  where p.id = p_actor_player_id and p.room_id = p_room_id and p.is_bot = false
    and p.session_revoked_at is null and p.session_expires_at > now();
  if actor_is_host is distinct from true then
    raise exception using errcode = '42501', message = 'HOST_REQUIRED';
  end if;
  if room_status is distinct from 'finished' then
    raise exception using errcode = 'P0001', message = 'GAME_NOT_FINISHED';
  end if;

  select count(*)::integer into player_count
  from public.players p where p.room_id = p_room_id and p.session_revoked_at is null and p.session_expires_at > now();
  if player_count < p_min_players then
    raise exception using errcode = 'P0001', message = 'NOT_ENOUGH_PLAYERS';
  end if;
  if player_count > p_max_players then
    raise exception using errcode = 'P0001', message = 'TOO_MANY_PLAYERS';
  end if;

  new_version := current_version + 1;
  update public.games g set ruleset_id = p_ruleset_id, ruleset_version = p_ruleset_version,
    phase = p_phase, day_number = p_day_number, version = new_version,
    public_state = p_public_state, secret_state = p_secret_state, random_seed = p_random_seed,
    updated_at = now(), finished_at = null
  where g.id = existing_game_id;
  insert into public.game_events(game_id, command_id, version, actor_player_id, event_type, payload)
  values (existing_game_id, p_command_id, new_version, p_actor_player_id, 'GAME_RESTARTED',
    jsonb_build_object('public', jsonb_build_object('phase', p_phase, 'dayNumber', p_day_number)));
  update public.rooms set status = 'in_progress', updated_at = now() where id = p_room_id;
  return query select existing_game_id, new_version, false;
end;
$$;

revoke all on function public.restart_room_game(uuid, uuid, uuid, text, text, integer, integer, text, integer, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.restart_room_game(uuid, uuid, uuid, text, text, integer, integer, text, integer, jsonb, jsonb, text) to service_role;

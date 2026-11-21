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
  select r.status into room_status from public.rooms r where r.id = p_room_id for update;
  if room_status not in ('lobby', 'finished') then
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

create or replace function public.manage_lobby_bot(
  p_room_id uuid,
  p_host_player_id uuid,
  p_operation text,
  p_bot_player_id uuid default null
)
returns table (bot_id uuid, display_name text)
language plpgsql
set search_path = public
as $$
declare
  room_status text;
  host_valid boolean;
  new_id uuid;
  new_name text;
  suffix integer := 1;
begin
  select r.status into room_status from public.rooms r where r.id = p_room_id for update;
  if room_status not in ('lobby', 'finished') then
    raise exception using errcode = 'P0001', message = 'ROOM_NOT_IN_LOBBY';
  end if;
  select p.is_host into host_valid from public.players p
  where p.id = p_host_player_id and p.room_id = p_room_id and p.is_bot = false
    and p.session_revoked_at is null and p.session_expires_at > now();
  if host_valid is distinct from true then
    raise exception using errcode = '42501', message = 'HOST_REQUIRED';
  end if;

  if p_operation = 'add' then
    if (select count(*) from public.players p where p.room_id = p_room_id
        and (p.is_bot or (p.session_revoked_at is null and p.session_expires_at > now()))) >= 15 then
      raise exception using errcode = 'P0001', message = 'ROOM_FULL';
    end if;
    loop
      new_name := 'Bot ' || suffix::text;
      exit when not exists (select 1 from public.players p where p.room_id = p_room_id and lower(p.display_name) = lower(new_name));
      suffix := suffix + 1;
    end loop;
    insert into public.players(room_id, display_name, session_token_hash, is_bot, is_ready, session_expires_at)
    values (p_room_id, new_name, null, true, true, 'infinity'::timestamptz)
    returning id into new_id;
    return query select new_id, new_name;
    return;
  elsif p_operation = 'remove' then
    delete from public.players p
    where p.id = p_bot_player_id and p.room_id = p_room_id and p.is_bot
    returning p.id, p.display_name into bot_id, display_name;
    if bot_id is null then
      raise exception using errcode = 'P0001', message = 'BOT_NOT_FOUND';
    end if;
    return next;
    return;
  end if;
  raise exception using errcode = '22023', message = 'INVALID_OPERATION';
end;
$$;

revoke all on function public.manage_lobby_bot(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.manage_lobby_bot(uuid, uuid, text, uuid) to service_role;

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
  from public.rooms r join public.players p on p.room_id = r.id
  where r.id = p_room_id and p.id = p_player_id
  for update of r, p;
  if room_status not in ('lobby', 'finished') then return false; end if;

  if player_is_host then
    select p.id into successor_id from public.players p
    where p.room_id = p_room_id and p.id <> p_player_id and p.is_bot = false
      and p.session_revoked_at is null and p.session_expires_at > now()
    order by p.joined_at, p.id limit 1 for update;
    if successor_id is not null then
      update public.players set is_host = true where id = successor_id;
    else
      delete from public.rooms where id = p_room_id;
      return true;
    end if;
  end if;
  delete from public.players where id = p_player_id and room_id = p_room_id;
  return true;
end;
$$;

revoke all on function public.leave_room_lobby(uuid, uuid) from public, anon, authenticated;
grant execute on function public.leave_room_lobby(uuid, uuid) to service_role;

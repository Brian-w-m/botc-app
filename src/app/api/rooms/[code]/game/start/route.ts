import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { findRoomPlayer, getPlayerSessionHash, logSupabaseError } from "@/lib/rooms/session";
import { getRuleset, TROUBLE_BREWING_RULESET_ID } from "@/lib/games/rulesets";
import { createGameRandomSeed, createSeededRandom } from "@/lib/games/random";
import { publishRoomVersion } from "@/lib/rooms/realtime";
import { scheduleBotAction } from "@/lib/games/bots";

const startSchema = z.object({ commandId: z.string().uuid() });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code: rawCode } = await params;
  const code = rawCode.toUpperCase();
  const sessionHash = getPlayerSessionHash(request);
  const parsed = startSchema.safeParse(await request.json().catch(() => null));
  if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) return NextResponse.json({ error: "This room code is invalid." }, { status: 400 });
  if (!sessionHash) return NextResponse.json({ error: "Join this room before starting a game." }, { status: 401 });
  if (!parsed.success) return NextResponse.json({ error: "A valid command ID is required." }, { status: 400 });

  const supabase = createAdminClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured on the server." }, { status: 503 });

  const { data: room, error: roomError } = await supabase.from("rooms")
    .select("id").eq("code", code).maybeSingle();
  if (roomError) {
    logSupabaseError("Room lookup for game start failed", roomError);
    return NextResponse.json({ error: "Could not load the room." }, { status: 500 });
  }
  if (!room) return NextResponse.json({ error: "This room no longer exists." }, { status: 404 });

  const { data: actor, error: actorError } = await findRoomPlayer(supabase, room.id, sessionHash);
  if (actorError) {
    logSupabaseError("Player lookup for game start failed", actorError);
    return NextResponse.json({ error: "Could not verify your player session." }, { status: 500 });
  }
  if (!actor) return NextResponse.json({ error: "Your player session is missing, expired, or revoked." }, { status: 401 });
  if (!actor.is_host) return NextResponse.json({ error: "Only the room creator can start this game." }, { status: 403 });

  const ruleset = getRuleset(TROUBLE_BREWING_RULESET_ID);
  if (!ruleset) {
    return NextResponse.json({ error: "The Trouble Brewing ruleset is not installed on the server yet." }, { status: 503 });
  }

  const { data: players, error: playersError } = await supabase.from("players")
    .select("id, display_name, is_host, is_bot")
    .eq("room_id", room.id)
    .is("session_revoked_at", null)
    .gt("session_expires_at", new Date().toISOString())
    .order("joined_at", { ascending: true });
  if (playersError) {
    logSupabaseError("Player list for game start failed", playersError);
    return NextResponse.json({ error: "Could not load the player list." }, { status: 500 });
  }
  const activePlayers = players ?? [];
  if (activePlayers.length < ruleset.minPlayers) {
    return NextResponse.json({ error: `At least ${ruleset.minPlayers} players are required to start.` }, { status: 409 });
  }
  if (activePlayers.length > ruleset.maxPlayers) {
    return NextResponse.json({ error: `This ruleset supports at most ${ruleset.maxPlayers} players.` }, { status: 409 });
  }

  const seed = createGameRandomSeed();
  let initialState;
  try {
    initialState = ruleset.createInitialState(
      activePlayers.map(player => ({ id: player.id, displayName: player.display_name, isHost: player.is_host, isBot: player.is_bot })),
      createSeededRandom(seed)
    );
    initialState = scheduleBotAction(ruleset, initialState, Date.now() + 5000);
  } catch (cause) {
    console.error("Ruleset initialization failed", cause);
    return NextResponse.json({ error: "The installed ruleset could not initialize this game." }, { status: 500 });
  }

  const { data, error } = await supabase.rpc("start_room_game", {
    p_room_id: room.id,
    p_actor_player_id: actor.id,
    p_command_id: parsed.data.commandId,
    p_ruleset_id: ruleset.id,
    p_ruleset_version: ruleset.version,
    p_min_players: ruleset.minPlayers,
    p_max_players: ruleset.maxPlayers,
    p_phase: initialState.phase,
    p_day_number: initialState.dayNumber,
    p_public_state: initialState.publicState,
    p_secret_state: initialState.secretState,
    p_random_seed: seed
  });
  if (error) {
    if (error.code === "42501") return NextResponse.json({ error: "Only the room creator can start this game." }, { status: 403 });
    if (error.code === "P0001") {
      if (error.message === "TOO_MANY_PLAYERS") return NextResponse.json({ error: `This ruleset supports at most ${ruleset.maxPlayers} players.` }, { status: 409 });
      if (error.message === "NOT_ENOUGH_PLAYERS") return NextResponse.json({ error: `At least ${ruleset.minPlayers} players are required to start.` }, { status: 409 });
      return NextResponse.json({ error: "The room changed before the game could start. Refresh and try again." }, { status: 409 });
    }
    logSupabaseError("Game start transaction failed", error);
    return NextResponse.json({ error: "Could not start the game." }, { status: 500 });
  }

  const result = Array.isArray(data) ? data[0] : null;
  if (!result) return NextResponse.json({ error: "The server did not confirm the game start." }, { status: 500 });
  if (!result.duplicate) await publishRoomVersion(supabase, room.id, result.game_version);
  return NextResponse.json({ gameId: result.game_id, version: result.game_version, duplicate: result.duplicate }, { status: 201 });
}

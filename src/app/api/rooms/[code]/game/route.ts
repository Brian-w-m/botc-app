import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { findRoomPlayer, getPlayerSessionHash, logSupabaseError } from "@/lib/rooms/session";
import { getRuleset, TROUBLE_BREWING_RULESET_ID } from "@/lib/games/rulesets";
import { hasBotAction } from "@/lib/games/bots";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code: rawCode } = await params;
  const code = rawCode.toUpperCase();
  const sessionHash = getPlayerSessionHash(request);
  if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) return NextResponse.json({ error: "This room code is invalid." }, { status: 400 });
  if (!sessionHash) return NextResponse.json({ error: "Join this room to view its game." }, { status: 401 });

  const supabase = createAdminClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured on the server." }, { status: 503 });

  const { data: room, error: roomError } = await supabase.from("rooms")
    .select("id").eq("code", code).maybeSingle();
  if (roomError) {
    logSupabaseError("Room lookup for game view failed", roomError);
    return NextResponse.json({ error: "Could not load the room." }, { status: 500 });
  }
  if (!room) return NextResponse.json({ error: "This room no longer exists." }, { status: 404 });

  const { data: player, error: playerError } = await findRoomPlayer(supabase, room.id, sessionHash);
  if (playerError) {
    logSupabaseError("Player lookup for game view failed", playerError);
    return NextResponse.json({ error: "Could not verify your player session." }, { status: 500 });
  }
  if (!player) return NextResponse.json({ error: "Your player session is missing, expired, or revoked." }, { status: 401 });

  const { data: game, error: gameError } = await supabase.from("games")
    .select("id, ruleset_id, ruleset_version, phase, day_number, version, public_state, secret_state")
    .eq("room_id", room.id).maybeSingle();
  if (gameError) {
    logSupabaseError("Game lookup failed", gameError);
    return NextResponse.json({ error: "Could not load the game." }, { status: 500 });
  }
  if (!game) {
    const ruleset = getRuleset(TROUBLE_BREWING_RULESET_ID);
    return NextResponse.json({
      game: null,
      currentPlayerId: player.id,
      isHost: player.is_host,
      rulesetAvailable: ruleset !== null,
      rulesetPlayerRange: ruleset ? { min: ruleset.minPlayers, max: ruleset.maxPlayers } : null
    });
  }

  const ruleset = getRuleset(game.ruleset_id);
  if (!ruleset || ruleset.version !== game.ruleset_version) {
    return NextResponse.json({ error: "This game’s ruleset version is not installed on the server." }, { status: 503 });
  }
  const privateState = ruleset.projectPrivateState(game.secret_state, player.id);

  return NextResponse.json({
    game: {
      id: game.id,
      roomId: room.id,
      rulesetId: game.ruleset_id,
      rulesetVersion: game.ruleset_version,
      phase: game.phase,
      dayNumber: game.day_number,
      version: game.version,
      publicState: ruleset.projectPublicState(game.secret_state)
    },
    privateState,
    botActionPending: hasBotAction(ruleset, {
      phase: game.phase,
      dayNumber: game.day_number,
      publicState: game.public_state,
      secretState: game.secret_state
    }),
    currentPlayerId: player.id,
    isHost: player.is_host
  });
}

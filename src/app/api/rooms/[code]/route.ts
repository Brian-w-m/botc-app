import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { findRoomPlayer, getPlayerSessionHash, logSupabaseError } from "@/lib/rooms/session";
import { getRuleset, TROUBLE_BREWING_RULESET_ID } from "@/lib/games/rulesets";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code: rawCode } = await params;
  const code = rawCode.toUpperCase();
  if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) {
    return NextResponse.json({ error: "This room code is invalid." }, { status: 400 });
  }
  const sessionHash = getPlayerSessionHash(request);
  if (!sessionHash) return NextResponse.json({ error: "Join this room to see its lobby." }, { status: 401 });

  const supabase = createAdminClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured on the server." }, { status: 503 });

  const { data: room, error: roomError } = await supabase
    .from("rooms")
    .select("id, code, status, created_at")
    .eq("code", code)
    .maybeSingle();
  if (roomError) {
    logSupabaseError("Room read failed", roomError);
    return NextResponse.json({ error: "Could not load this room. Check the server logs." }, { status: 500 });
  }
  if (!room) return NextResponse.json({ error: "This room no longer exists." }, { status: 404 });

  const { data: currentPlayer, error: playerError } = await findRoomPlayer(supabase, room.id, sessionHash);
  if (playerError) {
    logSupabaseError("Player session lookup failed", playerError);
    return NextResponse.json({ error: "Could not verify your player session." }, { status: 500 });
  }
  if (!currentPlayer) return NextResponse.json({ error: "Your player session is not in this room. Join again to continue." }, { status: 401 });

  const { data: players, error: playersError } = await supabase
    .from("players")
    .select("id, display_name, is_host, is_ready, is_bot, joined_at")
    .eq("room_id", room.id)
    .order("joined_at", { ascending: true });
  if (playersError) {
    logSupabaseError("Player list read failed", playersError);
    return NextResponse.json({ error: "Could not load the player list." }, { status: 500 });
  }

  const { data: game, error: gameError } = await supabase.from("games")
    .select("id, ruleset_id, ruleset_version, phase, day_number, version, public_state")
    .eq("room_id", room.id).maybeSingle();
  if (gameError) {
    logSupabaseError("Game summary read failed", gameError);
    return NextResponse.json({ error: "Could not load this room’s game status." }, { status: 500 });
  }
  const { data: history, error: historyError } = await supabase.from("game_history")
    .select("id,game_number,ruleset_id,ruleset_version,day_number,winner,public_state,finished_at")
    .eq("room_id", room.id).order("game_number", { ascending: false });
  if (historyError) {
    logSupabaseError("Game history read failed", historyError);
    return NextResponse.json({ error: "Could not load the game archive. Apply supabase/migrations/0007_game_history.sql." }, { status: 503 });
  }
  const ruleset = getRuleset(game?.ruleset_id ?? TROUBLE_BREWING_RULESET_ID);

  return NextResponse.json({
    room,
    players,
    currentPlayerId: currentPlayer.id,
    rulesetAvailable: ruleset !== null,
    rulesetPlayerRange: ruleset ? { min: ruleset.minPlayers, max: ruleset.maxPlayers } : null,
    gameHistory: (history ?? []).map(item => ({
      id: item.id,
      gameNumber: item.game_number,
      rulesetId: item.ruleset_id,
      rulesetVersion: item.ruleset_version,
      dayNumber: item.day_number,
      winner: item.winner,
      finishedAt: item.finished_at,
      publicState: item.public_state
    })),
    game: game ? {
      id: game.id,
      rulesetId: game.ruleset_id,
      rulesetVersion: game.ruleset_version,
      phase: game.phase,
      dayNumber: game.day_number,
      version: game.version,
      publicState: game.public_state
    } : null
  });
}

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { AuthoritativeGameState } from "@/domain/game/types";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  findRoomPlayer,
  getPlayerSessionHash,
  logSupabaseError,
} from "@/lib/rooms/session";
import { createSeededRandom } from "@/lib/games/random";
import {
  botActionDueAt,
  hasBotAction,
  runNextBotAction,
  scheduleBotAction,
} from "@/lib/games/bots";
import { getRuleset } from "@/lib/games/rulesets";
import { publishRoomVersion } from "@/lib/rooms/realtime";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code: rawCode } = await params;
  const code = rawCode.toUpperCase();
  const sessionHash = getPlayerSessionHash(request);
  if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code))
    return NextResponse.json(
      { error: "This room code is invalid." },
      { status: 400 },
    );
  if (!sessionHash)
    return NextResponse.json(
      { error: "Join this room before advancing bot turns." },
      { status: 401 },
    );

  const supabase = createAdminClient();
  if (!supabase)
    return NextResponse.json(
      { error: "Supabase is not configured on the server." },
      { status: 503 },
    );
  const { data: room, error: roomError } = await supabase
    .from("rooms")
    .select("id")
    .eq("code", code)
    .maybeSingle();
  if (roomError) {
    logSupabaseError("Room lookup for bot turn failed", roomError);
    return NextResponse.json(
      { error: "Could not load the room." },
      { status: 500 },
    );
  }
  if (!room)
    return NextResponse.json(
      { error: "This room no longer exists." },
      { status: 404 },
    );
  const { data: player, error: playerError } = await findRoomPlayer(
    supabase,
    room.id,
    sessionHash,
  );
  if (playerError) {
    logSupabaseError("Player lookup for bot turn failed", playerError);
    return NextResponse.json(
      { error: "Could not verify your player session." },
      { status: 500 },
    );
  }
  if (!player)
    return NextResponse.json(
      { error: "Your player session is missing, expired, or revoked." },
      { status: 401 },
    );

  const { data: game, error: gameError } = await supabase
    .from("games")
    .select(
      "id,ruleset_id,ruleset_version,phase,day_number,version,public_state,secret_state,random_seed",
    )
    .eq("room_id", room.id)
    .maybeSingle();
  if (gameError) {
    logSupabaseError("Game lookup for bot turn failed", gameError);
    return NextResponse.json(
      { error: "Could not load the game." },
      { status: 500 },
    );
  }
  if (!game) return NextResponse.json({ advanced: false });

  const ruleset = getRuleset(game.ruleset_id);
  if (!ruleset || ruleset.version !== game.ruleset_version)
    return NextResponse.json(
      { error: "This game’s ruleset version is not installed on the server." },
      { status: 503 },
    );
  const current: AuthoritativeGameState = {
    phase: game.phase,
    dayNumber: game.day_number,
    publicState: game.public_state,
    secretState: game.secret_state,
  };
  const dueAt = botActionDueAt(current);
  if (dueAt === null) {
    if (!hasBotAction(ruleset, current))
      return NextResponse.json({ advanced: false });
    const scheduled = scheduleBotAction(ruleset, current, Date.now() + 5000);
    const { data: commit, error: scheduleError } = await supabase.rpc(
      "commit_game_command",
      {
        p_game_id: game.id,
        p_command_id: randomUUID(),
        p_expected_version: game.version,
        p_actor_player_id: player.id,
        p_next_phase: scheduled.phase,
        p_next_day_number: scheduled.dayNumber,
        p_public_state: scheduled.publicState,
        p_secret_state: scheduled.secretState,
        p_event_type: "BOT_TURN_SCHEDULED",
        p_event_payload: { dueAt: botActionDueAt(scheduled) },
      },
    );
    if (scheduleError) {
      logSupabaseError("Bot turn scheduling failed", scheduleError);
      return NextResponse.json(
        { error: "Could not schedule the bot action." },
        { status: 500 },
      );
    }
    const scheduledCommit = Array.isArray(commit) ? commit[0] : null;
    if (!scheduledCommit?.accepted)
      return NextResponse.json(
        { advanced: false, stale: true },
        { status: 409 },
      );
    if (!scheduledCommit.duplicate)
      await publishRoomVersion(
        supabase,
        room.id,
        scheduledCommit.current_version,
      );
    return NextResponse.json({
      advanced: false,
      scheduled: true,
      version: scheduledCommit.current_version,
    });
  }
  if (Date.now() < dueAt) return NextResponse.json({ advanced: false });

  try {
    const random = createSeededRandom(
      `${game.random_seed}:${game.version}:bot-turn`,
    );
    const result = runNextBotAction(ruleset, current, random);
    if (!result) return NextResponse.json({ advanced: false });
    const nextState = scheduleBotAction(
      ruleset,
      result.state,
      Date.now() + 5000,
    );
    const { data: commit, error: commitError } = await supabase.rpc(
      "commit_game_command",
      {
        p_game_id: game.id,
        p_command_id: randomUUID(),
        p_expected_version: game.version,
        p_actor_player_id: result.action.actorId,
        p_next_phase: nextState.phase,
        p_next_day_number: nextState.dayNumber,
        p_public_state: nextState.publicState,
        p_secret_state: nextState.secretState,
        p_event_type: result.transition.eventType,
        p_event_payload: result.transition.eventPayload,
      },
    );
    if (commitError) {
      logSupabaseError("Bot turn transaction failed", commitError);
      return NextResponse.json(
        { error: "Could not save the bot action." },
        { status: 500 },
      );
    }
    const committed = Array.isArray(commit) ? commit[0] : null;
    if (!committed?.accepted)
      return NextResponse.json(
        { advanced: false, stale: true },
        { status: 409 },
      );
    if (!committed.duplicate)
      await publishRoomVersion(supabase, room.id, committed.current_version);
    return NextResponse.json({
      advanced: true,
      version: committed.current_version,
    });
  } catch (cause) {
    console.error("Bot action resolution failed", cause);
    return NextResponse.json(
      { error: "The bot action could not be resolved." },
      { status: 500 },
    );
  }
}

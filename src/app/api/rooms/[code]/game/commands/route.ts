import { NextResponse } from "next/server";
import { z } from "zod";
import type { AuthoritativeGameState, GameCommand } from "@/domain/game/types";
import { GameCommandError } from "@/domain/game/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { findRoomPlayer, getPlayerSessionHash, logSupabaseError } from "@/lib/rooms/session";
import { consumeRateLimit } from "@/lib/rooms/rate-limit";
import { createSeededRandom } from "@/lib/games/random";
import { getRuleset } from "@/lib/games/rulesets";
import { publishRoomVersion } from "@/lib/rooms/realtime";
import { scheduleBotAction } from "@/lib/games/bots";

const commandSchema = z.object({
  commandId: z.string().uuid(),
  expectedVersion: z.number().int().nonnegative(),
  command: z.record(z.string(), z.unknown()).refine(value => typeof value.type === "string")
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code: rawCode } = await params;
  const code = rawCode.toUpperCase();
  const sessionHash = getPlayerSessionHash(request);
  if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) return NextResponse.json({ error: "This room code is invalid." }, { status: 400 });
  if (!sessionHash) return NextResponse.json({ error: "Join this room before sending a game action." }, { status: 401 });
  if (Number(request.headers.get("content-length") ?? "0") > 16_384) {
    return NextResponse.json({ error: "The game command is too large." }, { status: 413 });
  }
  const parsed = commandSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "The game command is invalid." }, { status: 400 });

  const supabase = createAdminClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured on the server." }, { status: 503 });
  const rate = await consumeRateLimit(request, supabase, "game-command", 120, 60);
  if (rate.unavailable) return NextResponse.json({ error: "Game actions are temporarily unavailable because rate limiting could not be checked." }, { status: 503 });
  if (!rate.allowed) return NextResponse.json({ error: "Too many game actions. Try again shortly." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });

  const { data: room, error: roomError } = await supabase.from("rooms")
    .select("id").eq("code", code).maybeSingle();
  if (roomError) {
    logSupabaseError("Room lookup for game command failed", roomError);
    return NextResponse.json({ error: "Could not load the room." }, { status: 500 });
  }
  if (!room) return NextResponse.json({ error: "This room no longer exists." }, { status: 404 });

  const { data: player, error: playerError } = await findRoomPlayer(supabase, room.id, sessionHash);
  if (playerError) {
    logSupabaseError("Player lookup for game command failed", playerError);
    return NextResponse.json({ error: "Could not verify your player session." }, { status: 500 });
  }
  if (!player) return NextResponse.json({ error: "Your player session is missing, expired, or revoked." }, { status: 401 });

  const { data: game, error: gameError } = await supabase.from("games")
    .select("id, ruleset_id, ruleset_version, phase, day_number, version, public_state, secret_state, random_seed")
    .eq("room_id", room.id).maybeSingle();
  if (gameError) {
    logSupabaseError("Game lookup for command failed", gameError);
    return NextResponse.json({ error: "Could not load the game." }, { status: 500 });
  }
  if (!game) return NextResponse.json({ error: "This room has no game in progress." }, { status: 409 });

  const { data: priorCommand, error: priorCommandError } = await supabase.from("game_events")
    .select("version").eq("game_id", game.id).eq("command_id", parsed.data.commandId).maybeSingle();
  if (priorCommandError) {
    logSupabaseError("Idempotency lookup failed", priorCommandError);
    return NextResponse.json({ error: "Could not verify whether this action was already applied." }, { status: 500 });
  }
  if (priorCommand) return NextResponse.json({ version: game.version, duplicate: true });

  if (game.version !== parsed.data.expectedVersion) {
    return NextResponse.json({ error: "The game changed. Refresh before trying that action again.", currentVersion: game.version }, { status: 409 });
  }

  const ruleset = getRuleset(game.ruleset_id);
  if (!ruleset || ruleset.version !== game.ruleset_version) {
    return NextResponse.json({ error: "This game’s ruleset version is not installed on the server." }, { status: 503 });
  }

  let transition;
  const commandRandom = createSeededRandom(`${game.random_seed}:${game.version}:${parsed.data.commandId}`);
  try {
    transition = ruleset.applyCommand(
      {
        phase: game.phase,
        dayNumber: game.day_number,
        publicState: game.public_state,
        secretState: game.secret_state
      } as AuthoritativeGameState,
      { id: player.id, displayName: player.display_name, isHost: player.is_host },
      parsed.data.command as GameCommand,
      commandRandom
    );
    transition = {
      ...transition,
      state: scheduleBotAction(ruleset, transition.state, Date.now() + 5000)
    };
  } catch (cause) {
    if (cause instanceof GameCommandError) {
      return NextResponse.json({ error: cause.message, code: cause.code }, { status: 400 });
    }
    console.error("Ruleset command resolution failed", cause);
    return NextResponse.json({ error: "The game action could not be resolved." }, { status: 500 });
  }

  const { data: commit, error: commitError } = await supabase.rpc("commit_game_command", {
    p_game_id: game.id,
    p_command_id: parsed.data.commandId,
    p_expected_version: parsed.data.expectedVersion,
    p_actor_player_id: player.id,
    p_next_phase: transition.state.phase,
    p_next_day_number: transition.state.dayNumber,
    p_public_state: transition.state.publicState,
    p_secret_state: transition.state.secretState,
    p_event_type: transition.eventType,
    p_event_payload: transition.eventPayload
  });
  if (commitError) {
    logSupabaseError("Game command transaction failed", commitError);
    return NextResponse.json({ error: "Could not save the game action." }, { status: 500 });
  }
  const result = Array.isArray(commit) ? commit[0] : null;
  if (!result) return NextResponse.json({ error: "The server did not confirm the game action." }, { status: 500 });
  if (!result.accepted) {
    return NextResponse.json({ error: "The game changed. Refresh before trying that action again.", currentVersion: result.current_version }, { status: 409 });
  }
  if (!result.duplicate) await publishRoomVersion(supabase, room.id, result.current_version);
  return NextResponse.json({ version: result.current_version, duplicate: result.duplicate });
}

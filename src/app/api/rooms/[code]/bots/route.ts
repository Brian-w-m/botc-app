import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  findRoomPlayer,
  getPlayerSessionHash,
  logSupabaseError,
} from "@/lib/rooms/session";
import { publishRoomVersion } from "@/lib/rooms/realtime";

const botSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("add") }),
  z.object({ operation: z.literal("remove"), botPlayerId: z.string().uuid() }),
]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code: rawCode } = await params;
  const code = rawCode.toUpperCase();
  const sessionHash = getPlayerSessionHash(request);
  const body = botSchema.safeParse(await request.json().catch(() => null));
  if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code))
    return NextResponse.json(
      { error: "This room code is invalid." },
      { status: 400 },
    );
  if (!sessionHash)
    return NextResponse.json(
      { error: "Join this room before managing bots." },
      { status: 401 },
    );
  if (!body.success)
    return NextResponse.json(
      { error: "The bot operation is invalid." },
      { status: 400 },
    );

  const supabase = createAdminClient();
  if (!supabase)
    return NextResponse.json(
      { error: "Supabase is not configured on the server." },
      { status: 503 },
    );
  const { data: room, error: roomError } = await supabase
    .from("rooms")
    .select("id,status")
    .eq("code", code)
    .maybeSingle();
  if (roomError) {
    logSupabaseError("Room lookup for bot management failed", roomError);
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
  const { data: host, error: hostError } = await findRoomPlayer(
    supabase,
    room.id,
    sessionHash,
  );
  if (hostError) {
    logSupabaseError("Host lookup for bot management failed", hostError);
    return NextResponse.json(
      { error: "Could not verify your player session." },
      { status: 500 },
    );
  }
  if (!host)
    return NextResponse.json(
      { error: "Your player session is missing, expired, or revoked." },
      { status: 401 },
    );
  if (!host.is_host)
    return NextResponse.json(
      { error: "Only the host can manage bots." },
      { status: 403 },
    );

  const { data, error } = await supabase.rpc("manage_lobby_bot", {
    p_room_id: room.id,
    p_host_player_id: host.id,
    p_operation: body.data.operation,
    p_bot_player_id:
      body.data.operation === "remove" ? body.data.botPlayerId : null,
  });
  if (error) {
    if (error.code === "42501")
      return NextResponse.json(
        { error: "Only the host can manage bots." },
        { status: 403 },
      );
    if (error.code === "P0001" && error.message === "ROOM_NOT_IN_LOBBY") {
      if (room.status === "finished")
        return NextResponse.json(
          {
            error:
              "Post-game bot changes are not enabled in your Supabase database yet. Apply supabase/migrations/0006_post_game_lobby.sql, then try again.",
          },
          { status: 409 },
        );
      return NextResponse.json(
        {
          error:
            "Bots can only be changed in the lobby or after the game finishes.",
        },
        { status: 409 },
      );
    }
    if (error.code === "P0001" && error.message === "ROOM_FULL")
      return NextResponse.json(
        { error: "The table already has the maximum of 15 players." },
        { status: 409 },
      );
    if (error.code === "P0001" && error.message === "BOT_NOT_FOUND")
      return NextResponse.json(
        { error: "That bot is no longer in this lobby." },
        { status: 404 },
      );
    logSupabaseError("Bot operation failed", error);
    return NextResponse.json(
      {
        error:
          "Could not update the bot seats. Check that migration 0004 has been applied.",
      },
      { status: 500 },
    );
  }
  await publishRoomVersion(supabase, room.id, Date.now());
  const result = Array.isArray(data) ? data[0] : null;
  return NextResponse.json({ bot: result ?? null });
}

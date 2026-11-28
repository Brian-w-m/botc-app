import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  findRoomPlayer,
  getPlayerSessionHash,
  logSupabaseError,
} from "@/lib/rooms/session";
import { publishRoomVersion } from "@/lib/rooms/realtime";

const readySchema = z.object({ ready: z.boolean() });

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code: rawCode } = await params;
  const code = rawCode.toUpperCase();
  const sessionHash = getPlayerSessionHash(request);
  const parsed = readySchema.safeParse(await request.json().catch(() => null));
  if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) {
    return NextResponse.json(
      { error: "This room code is invalid." },
      { status: 400 },
    );
  }
  if (!sessionHash)
    return NextResponse.json(
      { error: "Join this room before changing your status." },
      { status: 401 },
    );
  if (!parsed.success)
    return NextResponse.json(
      { error: "Choose ready or not ready." },
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
    .select("id, status")
    .eq("code", code)
    .maybeSingle();
  if (roomError) {
    logSupabaseError("Room lookup for ready status failed", roomError);
    return NextResponse.json(
      { error: "Could not update your status." },
      { status: 500 },
    );
  }
  if (!room)
    return NextResponse.json(
      { error: "This room no longer exists." },
      { status: 404 },
    );
  if (room.status !== "lobby" && room.status !== "finished")
    return NextResponse.json(
      { error: "Ready status is locked while a game is running." },
      { status: 409 },
    );

  const { data: player, error: sessionError } = await findRoomPlayer(
    supabase,
    room.id,
    sessionHash,
  );
  if (sessionError) {
    logSupabaseError("Player session lookup failed", sessionError);
    return NextResponse.json(
      { error: "Could not verify your player session." },
      { status: 500 },
    );
  }
  if (!player)
    return NextResponse.json(
      { error: "Your player session is not in this room." },
      { status: 401 },
    );

  const { error } = await supabase
    .from("players")
    .update({ is_ready: parsed.data.ready })
    .eq("id", player.id)
    .eq("room_id", room.id);
  if (error) {
    logSupabaseError("Ready status update failed", error);
    return NextResponse.json(
      { error: "Could not update your ready status." },
      { status: 500 },
    );
  }
  await publishRoomVersion(supabase, room.id, Date.now());
  return NextResponse.json({ ready: parsed.data.ready });
}

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { findRoomPlayer, getPlayerSessionHash, logSupabaseError } from "@/lib/rooms/session";
import { publishRoomVersion } from "@/lib/rooms/realtime";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code: rawCode } = await params;
  const code = rawCode.toUpperCase();
  const sessionHash = getPlayerSessionHash(request);
  if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) return NextResponse.json({ error: "This room code is invalid." }, { status: 400 });
  if (!sessionHash) return NextResponse.json({ error: "Your player session is missing or expired." }, { status: 401 });

  const supabase = createAdminClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured on the server." }, { status: 503 });

  const { data: room, error: roomError } = await supabase.from("rooms")
    .select("id").eq("code", code).maybeSingle();
  if (roomError) {
    logSupabaseError("Room lookup for session revocation failed", roomError);
    return NextResponse.json({ error: "Could not leave this room." }, { status: 500 });
  }
  if (!room) return NextResponse.json({ error: "This room no longer exists." }, { status: 404 });

  const { data: player, error: playerError } = await findRoomPlayer(supabase, room.id, sessionHash);
  if (playerError) {
    logSupabaseError("Player lookup for session revocation failed", playerError);
    return NextResponse.json({ error: "Could not verify your player session." }, { status: 500 });
  }
  if (!player) return NextResponse.json({ error: "Your player session has expired or was revoked." }, { status: 401 });

  const { data: left, error } = await supabase.rpc("leave_room_lobby", {
    p_room_id: room.id,
    p_player_id: player.id
  });
  if (error) {
    logSupabaseError("Lobby leave failed", error);
    return NextResponse.json({ error: "Could not revoke this player session." }, { status: 500 });
  }
  if (!left) return NextResponse.json({ error: "A game is already in progress; this session must stay active so you can reconnect." }, { status: 409 });
  await publishRoomVersion(supabase, room.id, Date.now());
  return NextResponse.json({ revoked: true });
}

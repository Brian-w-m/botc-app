import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { findRoomPlayer, getPlayerSessionHash, logSupabaseError } from "@/lib/rooms/session";

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
    .select("id, display_name, is_host, is_ready, joined_at")
    .eq("room_id", room.id)
    .order("joined_at", { ascending: true });
  if (playersError) {
    logSupabaseError("Player list read failed", playersError);
    return NextResponse.json({ error: "Could not load the player list." }, { status: 500 });
  }

  return NextResponse.json({ room, players, currentPlayerId: currentPlayer.id });
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createPlayerSession, logSupabaseError } from "@/lib/rooms/session";
import { consumeRateLimit } from "@/lib/rooms/rate-limit";
import { publishRoomVersion } from "@/lib/rooms/realtime";

const joinSchema = z.object({
  displayName: z.string().trim().min(2).max(24)
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code: rawCode } = await params;
  const code = rawCode.toUpperCase();
  if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) {
    return NextResponse.json({ error: "Enter a valid six-character room code." }, { status: 400 });
  }

  const parsed = joinSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a display name between 2 and 24 characters." }, { status: 400 });
  }

  const supabase = createAdminClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured on the server." }, { status: 503 });

  const rate = await consumeRateLimit(request, supabase, "join-room", 30, 10 * 60);
  if (rate.unavailable) return NextResponse.json({ error: "Joining is temporarily unavailable because rate limiting could not be checked." }, { status: 503 });
  if (!rate.allowed) return NextResponse.json({ error: "Too many join attempts. Try again later." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });

  const { data: room, error: roomError } = await supabase
    .from("rooms")
    .select("id, status")
    .eq("code", code)
    .maybeSingle();
  if (roomError) {
    logSupabaseError("Room lookup failed", roomError);
    return NextResponse.json({ error: "Could not look up this room. Check the server logs." }, { status: 500 });
  }
  if (!room) return NextResponse.json({ error: "No room exists with that code." }, { status: 404 });
  if (room.status !== "lobby" && room.status !== "finished") return NextResponse.json({ error: "This room is no longer accepting players." }, { status: 409 });

  const session = createPlayerSession();
  const { data: playerId, error } = await supabase.rpc("join_room_lobby", {
    p_room_id: room.id,
    p_display_name: parsed.data.displayName,
    p_session_token_hash: session.tokenHash,
    p_session_expires_at: session.expiresAt
  });

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "That display name is already in this room. Choose another." }, { status: 409 });
    }
    if (error.code === "P0001" && error.message === "ROOM_NOT_JOINABLE") {
      return NextResponse.json({ error: "This room is no longer accepting players." }, { status: 409 });
    }
    logSupabaseError("Player join failed", error);
    return NextResponse.json({ error: "Could not join this room. Check your migrations and server logs." }, { status: 500 });
  }

  await publishRoomVersion(supabase, room.id, Date.now());
  return NextResponse.json({ playerId, sessionToken: session.token }, { status: 201 });
}

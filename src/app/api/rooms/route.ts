import { NextResponse } from "next/server";
import { randomInt } from "node:crypto";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createPlayerSession, logSupabaseError } from "@/lib/rooms/session";

const createRoomSchema = z.object({
  hostName: z.string().trim().min(2).max(24)
});

function makeRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join("");
}

export async function POST(request: Request) {
  const parsed = createRoomSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a display name between 2 and 24 characters." }, { status: 400 });
  }

  const supabase = createAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase is not configured. Add the URL, anon key and service role key to .env.local." }, { status: 503 });
  }

  // Retry rare room-code collisions. Database uniqueness is the final guard.
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = makeRoomCode();
    const { data: room, error } = await supabase.from("rooms").insert({
      code, host_display_name: parsed.data.hostName, status: "lobby"
    }).select("id").single();
    if (!error && room) {
      const session = createPlayerSession();
      const { error: playerError } = await supabase.from("players").insert({
        room_id: room.id,
        display_name: parsed.data.hostName,
        session_token_hash: session.tokenHash,
        is_host: true
      });
      if (!playerError) return NextResponse.json({ code, sessionToken: session.token }, { status: 201 });

      await supabase.from("rooms").delete().eq("id", room.id);
      logSupabaseError("Host player insert failed", playerError);
      return NextResponse.json({ error: "The room was created, but its host could not be added. Check your Supabase migrations and server logs." }, { status: 500 });
    }
    if (error?.code !== "23505") {
      if (error) logSupabaseError("Room insert failed", error);
      return NextResponse.json({ error: "Room could not be created. Check your Supabase migration and server logs." }, { status: 500 });
    }
  }
  return NextResponse.json({ error: "Could not allocate a room code. Please try again." }, { status: 503 });
}

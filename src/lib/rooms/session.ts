import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export function createPlayerSession() {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(
    Date.now() + 7 * 24 * 60 * 60 * 1000,
  ).toISOString();
  return { token, tokenHash, expiresAt };
}

export function getPlayerSessionHash(request: Request) {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer ([A-Za-z0-9_-]{40,50})$/);
  if (!match) return null;
  return createHash("sha256").update(match[1]).digest("hex");
}

export async function findRoomPlayer(
  supabase: SupabaseClient,
  roomId: string,
  sessionHash: string,
) {
  return supabase
    .from("players")
    .select("id, display_name, is_host, is_ready")
    .eq("room_id", roomId)
    .eq("session_token_hash", sessionHash)
    .is("session_revoked_at", null)
    .gt("session_expires_at", new Date().toISOString())
    .maybeSingle();
}

export function logSupabaseError(
  action: string,
  error: {
    code?: string;
    message: string;
    details?: string | null;
    hint?: string | null;
  },
) {
  console.error(action, {
    code: error.code,
    message: error.message,
    details: error.details,
    hint: error.hint,
  });
}

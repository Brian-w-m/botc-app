import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logSupabaseError } from "@/lib/rooms/session";

export async function consumeRateLimit(
  request: Request,
  supabase: SupabaseClient,
  scope: string,
  limit: number,
  windowSeconds: number,
) {
  // Vercel supplies this proxy-controlled header. Unknown local IPs share one bucket.
  const clientAddress =
    request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown";
  const bucketKey = createHash("sha256")
    .update(`${scope}\0${clientAddress}`)
    .digest("hex");

  const { data, error } = await supabase.rpc("consume_rate_limit", {
    p_bucket_key: bucketKey,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    logSupabaseError("Rate limit check failed", error);
    return { allowed: false, unavailable: true, retryAfterSeconds: 0 };
  }
  const result = Array.isArray(data) ? data[0] : null;
  return {
    allowed: result?.allowed === true,
    unavailable: false,
    retryAfterSeconds: Number(result?.retry_after_seconds ?? 0),
  };
}

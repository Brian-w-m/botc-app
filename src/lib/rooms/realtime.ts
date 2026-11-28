import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logSupabaseError } from "@/lib/rooms/session";

/** Broadcast only a revision signal; clients refetch authorized state over HTTP. */
export async function publishRoomVersion(
  supabase: SupabaseClient,
  roomId: string,
  revision: number,
) {
  const channel = supabase.channel(`room:${roomId}`, {
    config: { broadcast: { self: false, ack: true } },
  });
  try {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([
      channel.send({
        type: "broadcast",
        event: "room_state_changed",
        payload: { revision },
      }),
      new Promise<"timed out">((resolve) => {
        timeout = setTimeout(() => resolve("timed out"), 1500);
      }),
    ]).finally(() => {
      if (timeout) clearTimeout(timeout);
    });
    if (result !== "ok")
      console.warn("Room version broadcast was not confirmed", {
        roomId,
        result,
      });
  } catch (cause) {
    if (cause && typeof cause === "object" && "message" in cause) {
      logSupabaseError(
        "Room version broadcast failed",
        cause as {
          message: string;
          code?: string;
          details?: string | null;
          hint?: string | null;
        },
      );
    } else {
      console.warn("Room version broadcast failed", { roomId });
    }
  } finally {
    await supabase.removeChannel(channel);
  }
}

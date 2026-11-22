"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, LoaderCircle, MoonStar } from "lucide-react";
import { rememberPlayerSession } from "@/lib/rooms/client-session";

export default function CreateRoomPage() {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function createRoom(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/rooms", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hostName: name })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to create room.");
      rememberPlayerSession(result.code, name, result.sessionToken);
      window.location.assign(`/room/${result.code}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally { setBusy(false); }
  }

  return (
    <main className="min-h-screen px-6 py-8">
      <div className="mx-auto max-w-xl">
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-zinc-500 hover:text-white"><ArrowLeft size={16}/> Back</Link>
        <div className="mt-16 rounded-3xl border border-white/10 bg-[#131720] p-7 sm:p-10">
          <div className="grid size-12 place-items-center rounded-2xl bg-violet-300/10 text-violet-200"><MoonStar /></div>
          <h1 className="mt-7 text-3xl font-semibold">Start a new table</h1>
          <p className="mt-3 leading-7 text-zinc-400">Choose a display name. Your room will be ready for friends to join.</p>
          <form onSubmit={createRoom} className="mt-8 space-y-4">
            <label htmlFor="hostName" className="block text-sm text-zinc-300">Your display name</label>
            <input id="hostName" value={name} onChange={e => setName(e.target.value)} maxLength={24} minLength={2} required placeholder="e.g. Alex" className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3.5 outline-none placeholder:text-zinc-700 focus:border-violet-300/60" />
            {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
            <button disabled={busy || name.trim().length < 2} className="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-300 px-5 py-3.5 font-semibold text-zinc-950 disabled:cursor-not-allowed disabled:opacity-50">
              {busy && <LoaderCircle className="animate-spin" size={17}/>} Create room
            </button>
          </form>
          <p className="mt-5 text-xs leading-5 text-zinc-600">Your seat can be resumed from this browser if you close the window. Share the room code to invite others.</p>
        </div>
      </div>
    </main>
  );
}

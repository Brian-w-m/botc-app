"use client";

import { useState } from "react";
import { ArrowRight, LoaderCircle, UsersRound } from "lucide-react";

type JoinRoomFormProps = {
  initialCode?: string;
  onJoined?: (code: string) => void;
};

export default function JoinRoomForm({ initialCode = "", onJoined }: JoinRoomFormProps) {
  const [code, setCode] = useState(initialCode.toUpperCase());
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function joinRoom(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const normalizedCode = code.trim().toUpperCase();
    try {
      const response = await fetch(`/api/rooms/${normalizedCode}/players`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: name })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to join room.");

      window.sessionStorage.setItem(`nightfall:session:${normalizedCode}`, result.sessionToken);
      if (onJoined) onJoined(normalizedCode);
      else window.location.assign(`/room/${normalizedCode}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={joinRoom} className="space-y-4">
      <label className="block text-sm text-zinc-300" htmlFor="roomCode">Room code</label>
      <input
        id="roomCode"
        value={code}
        onChange={event => setCode(event.target.value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, "").slice(0, 6))}
        autoCapitalize="characters"
        autoComplete="off"
        maxLength={6}
        minLength={6}
        required
        placeholder="E.G. 7KQ2MP"
        className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3.5 font-mono tracking-[0.2em] outline-none placeholder:text-zinc-700 focus:border-violet-300/60"
      />
      <label className="block text-sm text-zinc-300" htmlFor="displayName">Your display name</label>
      <input
        id="displayName"
        value={name}
        onChange={event => setName(event.target.value)}
        maxLength={24}
        minLength={2}
        required
        placeholder="e.g. Alex"
        className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3.5 outline-none placeholder:text-zinc-700 focus:border-violet-300/60"
      />
      {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
      <button
        disabled={busy || code.length !== 6 || name.trim().length < 2}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-300 px-5 py-3.5 font-semibold text-zinc-950 transition hover:bg-violet-200 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? <LoaderCircle className="animate-spin" size={17} /> : onJoined ? <UsersRound size={17} /> : <ArrowRight size={17} />}
        Join room
      </button>
    </form>
  );
}

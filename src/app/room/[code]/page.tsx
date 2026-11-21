"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Clipboard, LoaderCircle, MoonStar, RefreshCw, UsersRound } from "lucide-react";
import JoinRoomForm from "@/components/JoinRoomForm";

type LobbyPlayer = {
  id: string;
  display_name: string;
  is_host: boolean;
  is_ready: boolean;
};

type Lobby = {
  room: { code: string; status: string };
  players: LobbyPlayer[];
  currentPlayerId: string;
};

export default function RoomPage({ params }: { params: Promise<{ code: string }> }) {
  // Next 15 provides route params as a promise; unwrap it in an effect-friendly way.
  const [code, setCode] = useState("");
  const [token, setToken] = useState("");
  const [lobby, setLobby] = useState<Lobby | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [readyBusy, setReadyBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    void params.then(({ code: routeCode }) => {
      if (!active) return;
      const normalized = routeCode.toUpperCase();
      setCode(normalized);
      const savedToken = window.sessionStorage.getItem(`nightfall:session:${normalized}`) ?? "";
      setToken(savedToken);
      if (!savedToken) setLoading(false);
    });
    return () => { active = false; };
  }, [params]);

  const refresh = useCallback(async () => {
    if (!code || !token) return;
    try {
      const response = await fetch(`/api/rooms/${code}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store"
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to load the room.");
      setLobby(result);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to refresh the room.");
    } finally {
      setLoading(false);
    }
  }, [code, token]);

  useEffect(() => {
    if (!token) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2500);
    return () => window.clearInterval(timer);
  }, [refresh, token]);

  async function toggleReady() {
    const current = lobby?.players.find(player => player.id === lobby.currentPlayerId);
    if (!current) return;
    setReadyBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/rooms/${code}/ready`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ready: !current.is_ready })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to update your status.");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update your status.");
    } finally {
      setReadyBusy(false);
    }
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("Copy wasn’t available. Select the room code to copy it.");
    }
  }

  const me = lobby?.players.find(player => player.id === lobby.currentPlayerId);
  const readyCount = lobby?.players.filter(player => player.is_ready).length ?? 0;

  return (
    <main className="min-h-screen px-6 py-8 sm:py-12">
      <div className="mx-auto max-w-3xl">
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-zinc-500 transition hover:text-white"><ArrowLeft size={16} /> Home</Link>

        {!token && !loading ? (
          <section className="mt-12 rounded-3xl border border-white/10 bg-[#131720] p-7 sm:p-10">
            <div className="grid size-12 place-items-center rounded-2xl bg-violet-300/10 text-violet-200"><UsersRound /></div>
            <p className="mt-7 text-xs font-medium tracking-[0.2em] text-violet-200">ROOM {code}</p>
            <h1 className="mt-3 text-3xl font-semibold">Take your seat</h1>
            <p className="mb-8 mt-3 leading-7 text-zinc-400">Choose a display name to join this table and see who else is here.</p>
            <JoinRoomForm initialCode={code} onJoined={() => {
              setToken(window.sessionStorage.getItem(`nightfall:session:${code}`) ?? "");
              setLoading(true);
            }} />
          </section>
        ) : loading && !lobby ? (
          <div className="mt-24 flex items-center justify-center gap-3 text-sm text-zinc-500"><LoaderCircle className="animate-spin" size={18} /> Opening the table…</div>
        ) : lobby ? (
          <>
            <header className="mt-9 flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-xs font-medium tracking-[0.22em] text-violet-200">THE LANTERN ROOM</p>
                <h1 className="mt-2 text-3xl font-semibold sm:text-4xl">Gather around</h1>
              </div>
              <div className="flex items-center gap-2 rounded-full border border-emerald-300/15 bg-emerald-300/[0.06] px-3 py-2 text-xs text-emerald-200">
                <span className="size-1.5 animate-pulse rounded-full bg-emerald-300" /> Lobby · Live
              </div>
            </header>

            <section className="mt-7 grid gap-5 md:grid-cols-[.8fr_1.2fr]">
              <div className="rounded-3xl border border-violet-200/10 bg-gradient-to-br from-violet-300/[0.12] via-[#131720] to-[#131720] p-6 sm:p-7">
                <div className="flex items-center gap-2 text-xs tracking-[0.16em] text-zinc-500"><MoonStar size={15} className="text-violet-200" /> ROOM CODE</div>
                <button onClick={copyCode} className="mt-6 flex w-full items-center justify-between rounded-2xl border border-white/10 bg-black/20 px-4 py-4 text-left transition hover:border-violet-200/30" aria-label="Copy room code">
                  <span className="font-mono text-3xl font-semibold tracking-[0.24em]">{code}</span>
                  {copied ? <Check size={17} className="text-emerald-300" /> : <Clipboard size={17} className="text-zinc-500" />}
                </button>
                <p className="mt-4 text-sm leading-6 text-zinc-500">Share this code with your group. They can join from the home page.</p>
                <div className="mt-7 border-t border-white/[0.08] pt-5">
                  <p className="text-sm font-medium">Ready to begin</p>
                  <p className="mt-1 text-xs text-zinc-500">{readyCount} of {lobby.players.length} players ready</p>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
                    <div className="h-full rounded-full bg-emerald-300 transition-all duration-500" style={{ width: `${lobby.players.length ? readyCount / lobby.players.length * 100 : 0}%` }} />
                  </div>
                </div>
              </div>

              <div className="rounded-3xl border border-white/10 bg-[#131720] p-6 sm:p-7">
                <div className="flex items-center justify-between border-b border-white/[0.08] pb-5">
                  <div>
                    <h2 className="font-medium">Players at the table</h2>
                    <p className="mt-1 text-xs text-zinc-500">{lobby.players.length} {lobby.players.length === 1 ? "player" : "players"} joined</p>
                  </div>
                  <button onClick={() => void refresh()} className="rounded-lg border border-white/10 p-2 text-zinc-500 transition hover:text-white" aria-label="Refresh player list"><RefreshCw size={15} /></button>
                </div>
                <ul className="mt-2 divide-y divide-white/[0.06]">
                  {lobby.players.map((player, index) => {
                    const isMe = player.id === lobby.currentPlayerId;
                    return (
                      <li key={player.id} className="flex items-center gap-3 py-3.5">
                        <div className={`grid size-10 shrink-0 place-items-center rounded-full text-sm font-medium ${player.is_host ? "bg-violet-300/15 text-violet-200" : "bg-white/[0.07] text-zinc-300"}`}>
                          {player.display_name.trim().slice(0, 1).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm text-zinc-200">{player.display_name}{isMe && <span className="ml-2 text-xs text-zinc-600">you</span>}</p>
                          <p className="mt-0.5 text-xs text-zinc-600">{player.is_host ? "Host" : `Seat ${index + 1}`}</p>
                        </div>
                        <span className={`ml-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${player.is_ready ? "bg-emerald-300/10 text-emerald-200" : "bg-white/[0.05] text-zinc-500"}`}>
                          <span className={`size-1.5 rounded-full ${player.is_ready ? "bg-emerald-300" : "bg-zinc-600"}`} />
                          {player.is_ready ? "Ready" : "Waiting"}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                <button onClick={() => void toggleReady()} disabled={!me || readyBusy} className={`mt-4 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3.5 font-medium transition disabled:opacity-50 ${me?.is_ready ? "border border-white/10 bg-white/[0.04] text-zinc-300 hover:bg-white/[0.07]" : "bg-violet-300 text-zinc-950 hover:bg-violet-200"}`}>
                  {readyBusy && <LoaderCircle className="animate-spin" size={16} />}
                  {me?.is_ready ? "I need a moment" : "I’m ready"}
                </button>
              </div>
            </section>
            {error && <p role="status" className="mt-4 rounded-xl border border-rose-300/15 bg-rose-300/[0.06] px-4 py-3 text-sm text-rose-200">{error}</p>}
            <p className="mt-5 text-center text-xs text-zinc-700">This lobby refreshes automatically every few seconds.</p>
          </>
        ) : (
          <section className="mt-12 rounded-3xl border border-white/10 bg-[#131720] p-8 text-center">
            <h1 className="text-2xl font-semibold">Room unavailable</h1>
            <p className="mt-3 text-sm text-zinc-500">{error || "We couldn’t load this room."}</p>
            <Link href="/join" className="mt-6 inline-flex rounded-xl bg-violet-300 px-5 py-3 font-medium text-zinc-950">Join another room</Link>
          </section>
        )}
      </div>
    </main>
  );
}

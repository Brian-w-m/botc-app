"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Bot, Check, Clipboard, LoaderCircle, LogOut, MoonStar, Plus, RefreshCw, UsersRound, X } from "lucide-react";
import JoinRoomForm from "@/components/JoinRoomForm";
import RoleSprite from "@/components/RoleSprite";
import { getBrowserSupabaseClient } from "@/lib/supabase/browser";
import { forgetPlayerSession, getPlayerSession } from "@/lib/rooms/client-session";

type LobbyPlayer = {
  id: string;
  display_name: string;
  is_host: boolean;
  is_ready: boolean;
  is_bot: boolean;
};

type Lobby = {
  room: { id: string; code: string; status: string };
  players: LobbyPlayer[];
  currentPlayerId: string;
  rulesetAvailable: boolean;
  rulesetPlayerRange: { min: number; max: number } | null;
  game: { id: string; phase: string; dayNumber: number; version: number } | null;
  gameHistory: Array<{
    id: number;
    gameNumber: number;
    rulesetId: string;
    rulesetVersion: string;
    dayNumber: number;
    winner: string | null;
    finishedAt: string;
    publicState: { revealedRoles?: Array<{ playerId: string; displayName: string; roleName: string; team: string }> };
  }>;
};

export default function RoomPage({ params }: { params: Promise<{ code: string }> }) {
  // Next 15 provides route params as a promise; unwrap it in an effect-friendly way.
  const [code, setCode] = useState("");
  const [token, setToken] = useState("");
  const [lobby, setLobby] = useState<Lobby | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [readyBusy, setReadyBusy] = useState(false);
  const [leaveBusy, setLeaveBusy] = useState(false);
  const [startBusy, setStartBusy] = useState(false);
  const [botBusy, setBotBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    void params.then(({ code: routeCode }) => {
      if (!active) return;
      const normalized = routeCode.toUpperCase();
      setCode(normalized);
      const savedToken = getPlayerSession(normalized);
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

  useEffect(() => {
    const roomId = lobby?.room.id;
    const client = getBrowserSupabaseClient();
    if (!roomId || !client || !token) return;

    const channel = client.channel(`room:${roomId}`, {
      config: { broadcast: { self: false } }
    }).on("broadcast", { event: "room_state_changed" }, () => {
      void refresh();
    }).subscribe();

    return () => { void client.removeChannel(channel); };
  }, [lobby?.room.id, refresh, token]);

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

  async function leaveRoom() {
    setLeaveBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/rooms/${code}/session`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to leave the room.");
      const displayName = lobby?.players.find(player => player.id === lobby.currentPlayerId)?.display_name ?? "";
      forgetPlayerSession(code, displayName);
      setToken("");
      setLobby(null);
      setLoading(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to leave the room.");
    } finally {
      setLeaveBusy(false);
    }
  }

  async function startGame() {
    setStartBusy(true);
    setError("");
    try {
      const endpoint = lobby?.game?.phase === "finished" ? "restart" : "start";
      const response = await fetch(`/api/rooms/${code}/game/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ commandId: crypto.randomUUID() })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to start the game.");
      window.location.assign(`/room/${code}/play`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to start the game.");
    } finally {
      setStartBusy(false);
    }
  }

  async function manageBot(operation: "add" | "remove", botPlayerId?: string) {
    setBotBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/rooms/${code}/bots`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(operation === "add" ? { operation } : { operation, botPlayerId })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to update bot seats.");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update bot seats.");
    } finally {
      setBotBusy(false);
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
              setToken(getPlayerSession(code));
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
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 rounded-full border border-emerald-300/15 bg-emerald-300/[0.06] px-3 py-2 text-xs text-emerald-200">
                  <span className={`size-1.5 rounded-full ${lobby.game?.phase === "finished" ? "bg-amber-200" : "animate-pulse bg-emerald-300"}`} /> {lobby.game?.phase === "finished" ? "Game finished · Lobby open" : lobby.game ? "Game in progress" : "Lobby · Live"}
                </div>
                <button onClick={() => void leaveRoom()} disabled={leaveBusy} className="flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-xs text-zinc-500 transition hover:text-white disabled:opacity-50" aria-label="Leave room">
                  {leaveBusy ? <LoaderCircle className="animate-spin" size={14} /> : <LogOut size={14} />}
                  Leave
                </button>
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
                {me?.is_host && (!lobby.game || lobby.game.phase === "finished") && (
                  <div className="mt-5">
                    <button
                      onClick={() => void startGame()}
                      disabled={startBusy || !lobby.rulesetAvailable || !lobby.rulesetPlayerRange || lobby.players.length < (lobby.rulesetPlayerRange?.min ?? Infinity) || lobby.players.length > (lobby.rulesetPlayerRange?.max ?? -Infinity)}
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-300 px-4 py-3 font-semibold text-zinc-950 transition hover:bg-violet-200 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {startBusy && <LoaderCircle className="animate-spin" size={16} />}
                      {lobby.game?.phase === "finished" ? "Start a new game" : "Start game"}
                    </button>
                    <p className="mt-2 text-xs leading-5 text-zinc-600">
                      {lobby.game?.phase === "finished" ? "Use this same group, and add or remove players and bots below before starting." : !lobby.rulesetAvailable ? "The Trouble Brewing ruleset has not been installed yet." : `Requires ${lobby.rulesetPlayerRange?.min}–${lobby.rulesetPlayerRange?.max} players.`}
                    </p>
                  </div>
                )}
                {lobby.game && (
                  <div className="mt-5 rounded-xl border border-violet-200/10 bg-violet-300/[0.06] p-4">
                    <p className="text-sm font-medium text-violet-100">{lobby.game.phase === "finished" ? "Game finished" : "Game in progress"}</p>
                    <p className="mt-1 text-xs capitalize text-zinc-400">{lobby.game.phase === "finished" ? "The previous game is complete. The host can prepare the next game here." : `${lobby.game.phase} · Day ${lobby.game.dayNumber}`}</p>
                    <Link href={`/room/${code}/play`} className="mt-3 inline-flex text-xs font-medium text-violet-200 underline decoration-violet-200/30 underline-offset-4">Open your private game view</Link>
                  </div>
                )}
              </div>

              <div className="rounded-3xl border border-white/10 bg-[#131720] p-6 sm:p-7">
                <div className="flex items-center justify-between border-b border-white/[0.08] pb-5">
                  <div>
                    <h2 className="font-medium">Players at the table</h2>
                    <p className="mt-1 text-xs text-zinc-500">{lobby.players.length} {lobby.players.length === 1 ? "player" : "players"} joined</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {me?.is_host && (!lobby.game || lobby.game.phase === "finished") && <button onClick={() => void manageBot("add")} disabled={botBusy || lobby.players.length >= (lobby.rulesetPlayerRange?.max ?? 15)} className="inline-flex items-center gap-2 rounded-lg border border-violet-200/15 bg-violet-300/[0.08] px-3 py-2 text-xs font-medium text-violet-100 transition hover:bg-violet-300/[0.14] disabled:opacity-40"><Plus size={14} /><Bot size={15} /> Add bot</button>}
                    <button onClick={() => void refresh()} className="rounded-lg border border-white/10 p-2 text-zinc-500 transition hover:text-white" aria-label="Refresh player list"><RefreshCw size={15} /></button>
                  </div>
                </div>
                <ul className="mt-2 divide-y divide-white/[0.06]">
                  {lobby.players.map((player, index) => {
                    const isMe = player.id === lobby.currentPlayerId;
                    return (
                      <li key={player.id} className="flex items-center gap-3 py-3.5">
                        <div className={`grid size-10 shrink-0 place-items-center rounded-full text-sm font-medium ${player.is_bot ? "bg-cyan-300/10 text-cyan-200" : player.is_host ? "bg-violet-300/15 text-violet-200" : "bg-white/[0.07] text-zinc-300"}`}>
                          {player.is_bot ? <Bot size={18} /> : player.display_name.trim().slice(0, 1).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm text-zinc-200">{player.display_name}{isMe && <span className="ml-2 text-xs text-zinc-600">you</span>}</p>
                          <p className="mt-0.5 text-xs text-zinc-600">{player.is_bot ? "Random bot" : player.is_host ? "Host" : `Seat ${index + 1}`}</p>
                        </div>
                        <span className={`ml-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${player.is_ready ? "bg-emerald-300/10 text-emerald-200" : "bg-white/[0.05] text-zinc-500"}`}>
                          <span className={`size-1.5 rounded-full ${player.is_ready ? "bg-emerald-300" : "bg-zinc-600"}`} />
                          {player.is_ready ? "Ready" : "Waiting"}
                        </span>
                        {me?.is_host && player.is_bot && (!lobby.game || lobby.game.phase === "finished") && <button onClick={() => void manageBot("remove", player.id)} disabled={botBusy} className="ml-1 rounded-lg p-2 text-zinc-600 transition hover:bg-rose-300/10 hover:text-rose-200 disabled:opacity-40" aria-label={`Remove ${player.display_name}`}><X size={15} /></button>}
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
            {lobby.gameHistory?.length > 0 && (
              <section className="mt-7 rounded-3xl border border-white/10 bg-[#131720] p-6 sm:p-7">
                <div className="flex items-center justify-between border-b border-white/[0.08] pb-4">
                  <div>
                    <h2 className="font-medium">Previous games</h2>
                    <p className="mt-1 text-xs text-zinc-500">Finished games from this room</p>
                  </div>
                  <span className="rounded-full bg-white/[0.06] px-3 py-1 text-xs text-zinc-400">{lobby.gameHistory.length}</span>
                </div>
                <ul className="divide-y divide-white/[0.06]">
                  {lobby.gameHistory.map(game => (
                    <li key={game.id} className="py-3">
                      <details>
                        <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 py-1 text-sm hover:text-white">
                          <span className="font-medium text-zinc-200">Game {game.gameNumber} <span className="ml-2 text-xs font-normal capitalize text-zinc-500">{game.rulesetId.replaceAll("-", " ")} · Day {game.dayNumber}</span></span>
                          <span className="text-xs text-amber-100">{game.winner ?? "Finished"}<span className="ml-2 text-zinc-600">{game.finishedAt.slice(0, 10)}</span></span>
                        </summary>
                        {game.publicState.revealedRoles?.length ? (
                          <ul className="mt-3 grid gap-2 border-t border-white/[0.06] pt-3 sm:grid-cols-2">
                            {game.publicState.revealedRoles.map(player => <li key={player.playerId} className="flex items-center gap-2 rounded-lg bg-black/15 px-3 py-2 text-xs"><RoleSprite roleName={player.roleName} size={36} className="size-9 shrink-0" /><span className="min-w-0 text-zinc-300">{player.displayName}<span className="ml-2 text-violet-200">{player.roleName}</span><span className="ml-1 text-zinc-600">· {player.team}</span></span></li>)}
                          </ul>
                        ) : <p className="mt-3 border-t border-white/[0.06] pt-3 text-xs text-zinc-500">Role reveal is unavailable for this archived game.</p>}
                      </details>
                    </li>
                  ))}
                </ul>
              </section>
            )}
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

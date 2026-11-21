"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, LoaderCircle, MoonStar, Skull, UsersRound } from "lucide-react";
import type { GameCommand, PlayerPrivateView, PublicGameView } from "@/domain/game/types";
import { getBrowserSupabaseClient } from "@/lib/supabase/browser";

type GameRead = {
  game: {
    id: string;
    roomId: string;
    rulesetId: string;
    rulesetVersion: string;
    phase: string;
    dayNumber: number;
    version: number;
    publicState: PublicGameView;
  } | null;
  privateState?: PlayerPrivateView | null;
  botActionPending?: boolean;
  isHost?: boolean;
  currentPlayerId?: string;
};

type Action = NonNullable<PlayerPrivateView["actions"]>[number];

export default function PlayPage({ params }: { params: Promise<{ code: string }> }) {
  const [code, setCode] = useState("");
  const [token, setToken] = useState("");
  const [gameRead, setGameRead] = useState<GameRead | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState("");
  const [clockNow, setClockNow] = useState(0);
  const autoOpenPending = useRef(false);
  const [error, setError] = useState("");

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
      const response = await fetch(`/api/rooms/${code}/game`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store"
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to load the game.");
      setGameRead(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to refresh the game.");
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
    if (!token || !code || !gameRead?.isHost || !gameRead.botActionPending) return;
    const timer = window.setInterval(() => {
      void fetch(`/api/rooms/${code}/game/bots/advance`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      }).then(async response => {
        if (!response.ok) return;
        const result = await response.json();
        if (result.advanced) await refresh();
      }).catch(() => undefined);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [code, gameRead?.botActionPending, gameRead?.isHost, refresh, token]);

  const discussionDeadline = gameRead?.game?.publicState.discussionEndsAt ?? null;
  useEffect(() => {
    if (gameRead?.game?.phase !== "day" || gameRead.game.publicState.dayStage !== "discussion") autoOpenPending.current = false;
  }, [discussionDeadline, gameRead?.game?.phase, gameRead?.game?.publicState.dayStage]);
  useEffect(() => {
    if (!discussionDeadline) return;
    setClockNow(Date.now());
    const timer = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [discussionDeadline]);

  useEffect(() => {
    const game = gameRead?.game;
    if (!game || game.phase !== "day" || game.publicState.dayStage !== "discussion" || !discussionDeadline || Date.now() < discussionDeadline || autoOpenPending.current) return;
    autoOpenPending.current = true;
    void fetch(`/api/rooms/${code}/game/commands`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ commandId: crypto.randomUUID(), expectedVersion: game.version, command: { type: "OPEN_NOMINATIONS" } })
    }).then(async response => {
      if (!response.ok) {
        autoOpenPending.current = false;
        await refresh();
        return;
      }
      await refresh();
    }).catch(() => {
      autoOpenPending.current = false;
      setError("The nomination timer ended, but nominations could not open. Retrying…");
    });
  }, [code, discussionDeadline, gameRead?.game, refresh, token]);

  useEffect(() => {
    const roomId = gameRead?.game?.roomId;
    const client = getBrowserSupabaseClient();
    if (!roomId || !client || !token) return;
    const channel = client.channel(`room:${roomId}`, {
      config: { broadcast: { self: false } }
    }).on("broadcast", { event: "room_state_changed" }, () => {
      void refresh();
    }).subscribe();
    return () => { void client.removeChannel(channel); };
  }, [gameRead?.game?.roomId, refresh, token]);

  async function sendAction(action: Action) {
    const game = gameRead?.game;
    if (!game) return;
    setActionId(action.id);
    setError("");
    try {
      const response = await fetch(`/api/rooms/${code}/game/commands`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          commandId: crypto.randomUUID(),
          expectedVersion: game.version,
          command: action.command satisfies GameCommand
        })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "That action could not be submitted.");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That action could not be submitted.");
      await refresh();
    } finally {
      setActionId("");
    }
  }

  const game = gameRead?.game;
  const privateView = gameRead?.privateState;
  const publicView = game?.publicState;
  const dayActions = game?.phase === "day" ? privateView?.actions.filter(action => action.command.type === "NOMINATE" || action.command.type === "VOTE" || action.command.type === "OPEN_NOMINATIONS" || action.command.type === "CLOSE_NOMINATIONS") ?? [] : [];
  const roleActions = privateView?.actions.filter(action => action.command.type !== "NOMINATE" && action.command.type !== "VOTE" && action.command.type !== "OPEN_NOMINATIONS" && action.command.type !== "CLOSE_NOMINATIONS") ?? [];
  const discussionSeconds = discussionDeadline ? Math.max(0, Math.ceil((discussionDeadline - clockNow) / 1000)) : 0;
  const discussionClock = `${Math.floor(discussionSeconds / 60)}:${String(discussionSeconds % 60).padStart(2, "0")}`;

  return (
    <main className="min-h-screen px-5 py-7 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-4xl">
        <Link href={`/room/${code}`} className="inline-flex items-center gap-2 text-sm text-zinc-500 transition hover:text-white"><ArrowLeft size={16} /> Room lobby</Link>

        {!token ? (
          <section className="mt-12 rounded-3xl border border-white/10 bg-[#131720] p-8 text-center">
            <h1 className="text-2xl font-semibold">Player session unavailable</h1>
            <p className="mt-3 text-sm text-zinc-500">Join the room again from this device to continue.</p>
            <Link href={`/room/${code}`} className="mt-6 inline-flex rounded-xl bg-violet-300 px-5 py-3 font-medium text-zinc-950">Return to room</Link>
          </section>
        ) : loading && !game ? (
          <div className="mt-24 flex items-center justify-center gap-3 text-sm text-zinc-500"><LoaderCircle className="animate-spin" size={18} /> Loading your private game view…</div>
        ) : game ? (
          <>
            <header className="mt-8 flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-xs font-medium tracking-[0.22em] text-violet-200">{game.rulesetId.replaceAll("-", " ")} · {game.rulesetVersion}</p>
                <h1 className="mt-2 text-3xl font-semibold capitalize sm:text-4xl">{game.phase}{game.phase === "night" || game.phase === "day" ? ` ${game.dayNumber}` : ""}</h1>
              </div>
              <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-zinc-400">
                <MoonStar size={14} className="text-violet-200" /> Version {game.version}
              </div>
            </header>

            {game.phase === "finished" && (
              <section className="mt-6 rounded-3xl border border-amber-200/20 bg-gradient-to-br from-amber-200/[0.12] to-[#131720] p-6 sm:p-8" role="status">
                <p className="text-xs font-medium tracking-[0.2em] text-amber-100/70">GAME OVER</p>
                <h2 className="mt-2 text-3xl font-semibold text-amber-50">{publicView?.headline ?? "The game has ended"}</h2>
                <p className="mt-2 text-sm text-zinc-400">The winning team has been decided. Return to the lobby to prepare the next game.</p>
                {publicView?.revealedRoles && (
                  <div className="mt-6 rounded-2xl border border-white/10 bg-black/20 p-4 sm:p-5">
                    <h3 className="text-sm font-semibold tracking-wide text-amber-50">Everyone’s roles</h3>
                    <ul className="mt-3 divide-y divide-white/[0.07]">
                      {publicView.revealedRoles.map(player => (
                        <li key={player.playerId} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3">
                          <span className="text-sm font-medium text-zinc-100">{player.displayName}{player.alive ? "" : " · dead"}</span>
                          <span className="text-sm text-amber-100">{player.roleName} <span className="text-zinc-500">· {player.team}</span>{player.believedAs && <span className="block text-xs text-zinc-500">Believed they were {player.believedAs}</span>}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <Link href={`/room/${code}`} className="mt-5 inline-flex items-center justify-center rounded-xl bg-amber-100 px-5 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-white">Return to lobby</Link>
              </section>
            )}

            <section className="mt-6 grid gap-5 lg:grid-cols-[1fr_.9fr]">
              <div className="space-y-5">
                <article className="rounded-3xl border border-white/10 bg-[#131720] p-6 sm:p-7">
                  <div className="flex items-center gap-2 text-xs font-medium tracking-[0.16em] text-zinc-500"><UsersRound size={15} /> THE TOWN</div>
                  <h2 className="mt-4 text-xl font-semibold">{publicView?.headline || "The game is underway"}</h2>
                  <ul className="mt-4 divide-y divide-white/[0.06]">
                    {publicView?.players?.map(player => (
                      <li key={player.id} className="flex items-center gap-3 py-3">
                        <span className={`size-2 rounded-full ${player.alive ? "bg-emerald-300" : "bg-zinc-700"}`} />
                        <span className={`text-sm ${player.alive ? "text-zinc-200" : "text-zinc-600 line-through"}`}>{player.displayName}</span>
                        {!player.alive && <Skull className="ml-auto text-zinc-700" size={15} />}
                        {player.hasGhostVote && !player.alive && <span className="ml-auto text-[10px] uppercase tracking-wider text-violet-200">Ghost vote</span>}
                      </li>
                    ))}
                  </ul>
                  {publicView?.currentNomination && (
                    <div className="mt-4 rounded-xl border border-amber-200/10 bg-amber-200/[0.04] p-4">
                      <p className="text-xs uppercase tracking-wider text-amber-100/70">Current nomination</p>
                      <p className="mt-1 font-medium">{publicView.currentNomination.nomineeName}</p>
                      <p className="mt-1 text-xs text-zinc-500">{publicView.currentNomination.votesFor} votes so far</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {publicView.currentNomination.ballots.map(ballot => <span key={ballot.playerId} className={`rounded-full px-2.5 py-1 text-xs ${ballot.vote ? "bg-emerald-300/10 text-emerald-200" : "bg-zinc-700/50 text-zinc-400"}`}>{ballot.displayName}: {ballot.vote ? "Yes" : "No"}</span>)}
                      </div>
                    </div>
                  )}
                  {publicView?.executionBlock && (
                    <div className="mt-4 rounded-xl border border-rose-200/15 bg-rose-200/[0.05] p-4" role="status">
                      <p className="text-xs uppercase tracking-wider text-rose-100/70">On the block</p>
                      <p className="mt-1 font-medium text-rose-50">{publicView.executionBlock.nomineeName}</p>
                      <p className="mt-1 text-xs text-zinc-400">{publicView.executionBlock.votes} votes. A later nomination needs at least {Math.max(publicView.executionBlock.votes + 1, publicView.votesRequiredForBlock ?? 1)} votes to take the block. The host resolves the final block when nominations close.</p>
                    </div>
                  )}
                  {publicView?.executionBlockTied && (
                    <p className="mt-4 rounded-xl border border-amber-200/10 bg-amber-200/[0.04] p-4 text-sm text-amber-100/80">The leading nomination votes are tied. No one is currently on the block.</p>
                  )}
                  {Boolean(publicView?.notices?.length) && (
                    <section aria-label="This night and day log" aria-live="polite" className="mt-5 border-t border-white/[0.06] pt-4">
                      <h3 className="text-xs font-medium tracking-[0.16em] text-zinc-500">THIS NIGHT &amp; DAY</h3>
                      <ol className="mt-2 space-y-2">
                        {publicView?.notices?.map((notice, index) => <li key={`${index}-${notice}`} className="text-sm leading-6 text-zinc-400">{notice}</li>)}
                      </ol>
                    </section>
                  )}
                  {game.phase === "day" && (
                    <section className="mt-5 rounded-2xl border border-amber-200/15 bg-amber-200/[0.04] p-4">
                      <p className="text-xs font-medium tracking-[0.16em] text-amber-100/70">DAY ACTIONS</p>
                      <h3 className="mt-2 text-lg font-semibold">{publicView?.dayStage === "discussion" ? `Discussion · ${discussionClock}` : publicView?.currentNomination ? `Vote on ${publicView.currentNomination.nomineeName}` : "Nominations are open"}</h3>
                      {publicView?.dayStage !== "discussion" && publicView?.votesRequiredForBlock !== undefined && <p className="mt-1 text-xs text-amber-100/70">{publicView.votesRequiredForBlock} votes from {publicView.livingPlayerCount} living {publicView.livingPlayerCount === 1 ? "player" : "players"} are needed to get on the block.</p>}
                      <p className="mt-1 text-sm leading-6 text-zinc-400">{privateView?.prompt ?? (publicView?.currentNomination ? "Vote on the open nomination before another one begins." : "You cannot nominate while dead. Wait for an alive player to make a nomination.")}</p>
                      {dayActions.length > 0 ? (
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          {dayActions.map(action => <button key={action.id} onClick={() => void sendAction(action)} disabled={Boolean(actionId)} className="rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2.5 text-left text-sm text-zinc-200 transition hover:border-amber-100/20 hover:bg-amber-100/[0.08] disabled:opacity-50">{action.label}</button>)}
                        </div>
                      ) : <p className="mt-3 text-xs text-zinc-500">{publicView?.currentNomination ? "Your vote may already be recorded, or the game is waiting for the other players." : "You may have already nominated today. Nominations can also be unavailable while a vote is open."}</p>}
                    </section>
                  )}
                </article>
              </div>

              <aside className="rounded-3xl border border-violet-200/15 bg-gradient-to-br from-violet-300/[0.11] via-[#131720] to-[#131720] p-6 sm:p-7">
                {privateView ? (
                  <>
                    <p className="text-xs font-medium tracking-[0.18em] text-violet-200">YOUR PRIVATE ROLE</p>
                    <h2 className="mt-3 text-3xl font-semibold">{privateView.role.name}</h2>
                    <p className="mt-2 text-sm capitalize text-zinc-400">{privateView.role.team}</p>
                    <p className="mt-5 border-t border-white/10 pt-5 text-sm leading-6 text-zinc-300">{privateView.role.ability}</p>
                    {privateView.information.map((info, index) => <p key={`${index}-${info}`} className="mt-3 rounded-xl bg-black/20 p-3 text-sm leading-6 text-violet-100/90">{info}</p>)}
                    {privateView.prompt && <p className="mt-5 text-sm font-medium leading-6 text-white">{privateView.prompt}</p>}
                    {roleActions.length > 0 && (
                      <div className="mt-5 space-y-2">
                        {roleActions.map(action => (
                          <button key={action.id} onClick={() => void sendAction(action)} disabled={Boolean(actionId)} className="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-300 px-4 py-3 font-semibold text-zinc-950 transition hover:bg-violet-200 disabled:cursor-wait disabled:opacity-50">
                            {actionId === action.id && <LoaderCircle className="animate-spin" size={16} />}
                            {action.label}
                          </button>
                        ))}
                      </div>
                    )}
                    {roleActions.length === 0 && <p className="mt-5 text-xs text-zinc-600">{game.phase === "day" ? "Your nomination and voting options are shown in the Town panel." : "No action is waiting for you. The app will update this view as the game progresses."}</p>}
                  </>
                ) : (
                  <div>
                    <p className="text-xs font-medium tracking-[0.18em] text-violet-200">PRIVATE VIEW</p>
                    <h2 className="mt-3 text-2xl font-semibold">Waiting for your information</h2>
                    <p className="mt-3 text-sm leading-6 text-zinc-500">Your role and any private information appear here. They are sent only to your player session.</p>
                  </div>
                )}
              </aside>
            </section>
            {error && <p role="alert" className="mt-4 rounded-xl border border-rose-300/15 bg-rose-300/[0.06] px-4 py-3 text-sm text-rose-200">{error}</p>}
          </>
        ) : (
          <section className="mt-12 rounded-3xl border border-white/10 bg-[#131720] p-8 text-center">
            <h1 className="text-2xl font-semibold">No game has started</h1>
            <p className="mt-3 text-sm text-zinc-500">{error || "Return to the lobby; the room creator can start when the ruleset is installed and enough players have joined."}</p>
            <Link href={`/room/${code}`} className="mt-6 inline-flex rounded-xl bg-violet-300 px-5 py-3 font-medium text-zinc-950">Return to lobby</Link>
          </section>
        )}
      </div>
    </main>
  );
}

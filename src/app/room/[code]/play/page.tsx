"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BookOpen,
  LoaderCircle,
  MoonStar,
  Skull,
  UsersRound,
} from "lucide-react";
import type {
  GameCommand,
  PlayerPrivateView,
  PublicGameView,
} from "@/domain/game/types";
import RoleSprite from "@/components/RoleSprite";
import { getBrowserSupabaseClient } from "@/lib/supabase/browser";
import { getPlayerSession } from "@/lib/rooms/client-session";

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

export default function PlayPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const [code, setCode] = useState("");
  const [token, setToken] = useState("");
  const [gameRead, setGameRead] = useState<GameRead | null>(null);
  const gameReadRef = useRef<GameRead | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState("");
  const [clockNow, setClockNow] = useState(0);
  const autoOpenPending = useRef(false);
  const nominationAdvancePending = useRef<string | null>(null);
  const voteAdvancePending = useRef<string | null>(null);
  const lastNightVibration = useRef<string | null>(null);
  const [error, setError] = useState("");

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
    return () => {
      active = false;
    };
  }, [params]);

  const refresh = useCallback(
    async (minimumVersion = 0): Promise<GameRead | null> => {
      if (!code || !token) return null;
      try {
        let result: GameRead | null = null;
        for (let attempt = 0; attempt < 20; attempt++) {
          const response = await fetch(`/api/rooms/${code}/game`, {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
          });
          const snapshot = await response.json();
          if (!response.ok)
            throw new Error(snapshot.error ?? "Unable to load the game.");
          result = snapshot as GameRead;
          if (!result.game || result.game.version >= minimumVersion) break;
          await new Promise((resolve) => window.setTimeout(resolve, 150));
        }
        if (!result || (result.game && result.game.version < minimumVersion)) {
          throw new Error(
            "The latest game state is not available yet. Please try again.",
          );
        }
        const current = gameReadRef.current;
        const latest =
          current?.game &&
          result.game &&
          current.game.id === result.game.id &&
          current.game.version > result.game.version
            ? current
            : result;
        gameReadRef.current = latest;
        setGameRead(latest);
        return latest;
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : "Unable to refresh the game",
        );
        return null;
      } finally {
        setLoading(false);
      }
    },
    [code, token],
  );

  useEffect(() => {
    if (!token) return;
    void refresh();
    // A vote seat lasts three seconds. Keep the live view fresh enough that
    // players don't submit a hand change against a several-second-old snapshot.
    const publicState = gameRead?.game?.publicState;
    const pollInterval =
      publicState?.nominationStage === "voting"
        ? 400
        : publicState?.currentNomination
          ? 2000
          : 2500;
    const timer = window.setInterval(() => void refresh(), pollInterval);
    return () => window.clearInterval(timer);
  }, [
    gameRead?.game?.publicState.currentNomination?.nomineeId,
    gameRead?.game?.publicState.nominationStage,
    refresh,
    token,
  ]);

  useEffect(() => {
    if (!token || !code || !gameRead?.isHost || !gameRead.botActionPending)
      return;
    const timer = window.setInterval(() => {
      void fetch(`/api/rooms/${code}/game/bots/advance`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      })
        .then(async (response) => {
          if (!response.ok) return;
          const result = await response.json();
          if (result.advanced) await refresh();
        })
        .catch(() => undefined);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [code, gameRead?.botActionPending, gameRead?.isHost, refresh, token]);

  useEffect(() => {
    const game = gameRead?.game;
    const actions =
      gameRead?.privateState?.actions.filter(
        (action) => action.command.type === "NIGHT_CHOOSE",
      ) ?? [];
    if (!game || game.phase !== "night" || actions.length === 0) return;

    const promptKey = `${game.id}:${game.dayNumber}:${actions
      .map((action) => action.id)
      .sort()
      .join("|")}`;
    if (lastNightVibration.current === promptKey) return;
    lastNightVibration.current = promptKey;

    // Vibration is a progressive enhancement; browsers without the API simply
    // keep using the regular private action prompt.
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate([250, 120, 250]);
    }
  }, [
    gameRead?.game?.dayNumber,
    gameRead?.game?.id,
    gameRead?.game?.phase,
    gameRead?.privateState?.actions,
  ]);

  const discussionDeadline =
    gameRead?.game?.publicState.discussionEndsAt ?? null;
  const nominationDeadline =
    gameRead?.game?.publicState.nominationEndsAt ?? null;
  const voteTurnDeadline = gameRead?.game?.publicState.voteTurnEndsAt ?? null;
  useEffect(() => {
    if (
      gameRead?.game?.phase !== "day" ||
      gameRead.game.publicState.dayStage !== "discussion"
    )
      autoOpenPending.current = false;
  }, [
    discussionDeadline,
    gameRead?.game?.phase,
    gameRead?.game?.publicState.dayStage,
  ]);
  useEffect(() => {
    if (!discussionDeadline && !nominationDeadline && !voteTurnDeadline) return;
    setClockNow(Date.now());
    const timer = window.setInterval(() => setClockNow(Date.now()), 200);
    return () => window.clearInterval(timer);
  }, [discussionDeadline, nominationDeadline, voteTurnDeadline]);

  useEffect(() => {
    const game = gameRead?.game;
    if (
      !game ||
      game.phase !== "day" ||
      game.publicState.dayStage !== "discussion" ||
      !discussionDeadline ||
      Date.now() < discussionDeadline ||
      autoOpenPending.current
    )
      return;
    autoOpenPending.current = true;
    void fetch(`/api/rooms/${code}/game/commands`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        commandId: crypto.randomUUID(),
        expectedVersion: game.version,
        command: { type: "OPEN_NOMINATIONS" },
      }),
    })
      .then(async (response) => {
        if (!response.ok) {
          autoOpenPending.current = false;
          await refresh();
          return;
        }
        await refresh();
      })
      .catch(() => {
        autoOpenPending.current = false;
        setError(
          "The nomination timer ended, but nominations could not open. Retrying…",
        );
      });
  }, [code, discussionDeadline, gameRead?.game, refresh, token]);

  useEffect(() => {
    const game = gameRead?.game;
    const nomination = game?.publicState.currentNomination;
    const stage = game?.publicState.nominationStage;
    if (
      !game ||
      !token ||
      !code ||
      !nomination ||
      !stage ||
      !nominationDeadline
    )
      return;
    const requestKey = `${game.id}:${nomination.nomineeId}:${stage}:${nominationDeadline}`;
    const timer = window.setInterval(() => {
      if (
        Date.now() < nominationDeadline ||
        nominationAdvancePending.current === requestKey
      )
        return;
      const latest = gameReadRef.current;
      if (
        !latest?.game ||
        latest.game.id !== game.id ||
        latest.game.publicState.currentNomination?.nomineeId !==
          nomination.nomineeId ||
        latest.game.publicState.nominationStage !== stage
      )
        return;
      nominationAdvancePending.current = requestKey;
      void fetch(`/api/rooms/${code}/game/commands`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          commandId: crypto.randomUUID(),
          expectedVersion: latest.game.version,
          command: {
            type: "ADVANCE_NOMINATION",
            nomineeId: nomination.nomineeId,
            stage,
          },
        }),
      })
        .then(async (response) => {
          if (!response.ok)
            setError(
              "The nomination timer could not advance. Refreshing the game…",
            );
          const result = await response.json();
          await refresh(
            typeof result.version === "number" ? result.version : 0,
          );
          if (result.pending)
            window.setTimeout(() => {
              if (nominationAdvancePending.current === requestKey)
                nominationAdvancePending.current = null;
            }, 500);
        })
        .catch(() =>
          setError("The nomination timer could not advance. Retrying…"),
        )
        .finally(() => {
          window.setTimeout(() => {
            if (nominationAdvancePending.current === requestKey)
              nominationAdvancePending.current = null;
          }, 500);
        });
    }, 100);
    return () => window.clearInterval(timer);
  }, [code, gameRead?.game, nominationDeadline, refresh, token]);

  useEffect(() => {
    const game = gameRead?.game;
    const nomination = game?.publicState.currentNomination;
    const voter = game?.publicState.currentVoter;
    if (!game || !token || !code || !nomination || !voter || !voteTurnDeadline)
      return;

    const requestKey = `${game.id}:${nomination.nomineeId}:${voter.playerId}:${voteTurnDeadline}`;
    const timer = window.setInterval(() => {
      if (
        Date.now() < voteTurnDeadline ||
        voteAdvancePending.current === requestKey
      )
        return;
      const latest = gameReadRef.current;
      if (
        !latest?.game ||
        latest.game.id !== game.id ||
        latest.game.publicState.currentNomination?.nomineeId !==
          nomination.nomineeId ||
        latest.game.publicState.currentVoter?.playerId !== voter.playerId
      )
        return;

      voteAdvancePending.current = requestKey;
      void fetch(`/api/rooms/${code}/game/commands`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          commandId: crypto.randomUUID(),
          expectedVersion: latest.game.version,
          // Bind this timer request to the seat it was created for. Concurrent
          // clients can then safely treat an already-passed seat as superseded.
          command: {
            type: "ADVANCE_VOTE",
            nomineeId: nomination.nomineeId,
            playerId: voter.playerId,
          },
        }),
      })
        .then(async (response) => {
          if (!response.ok) {
            await refresh();
            return;
          }
          const result = await response.json();
          await refresh(
            typeof result.version === "number" ? result.version : 0,
          );
        })
        .catch(() => setError("The vote sweep could not advance. Retrying…"))
        .finally(() => {
          if (voteAdvancePending.current === requestKey)
            voteAdvancePending.current = null;
        });
    }, 100);

    return () => window.clearInterval(timer);
  }, [code, gameRead?.game, refresh, token, voteTurnDeadline]);

  useEffect(() => {
    const roomId = gameRead?.game?.roomId;
    const client = getBrowserSupabaseClient();
    if (!roomId || !client || !token) return;
    const channel = client
      .channel(`room:${roomId}`, {
        config: { broadcast: { self: false } },
      })
      .on("broadcast", { event: "room_state_changed" }, () => {
        void refresh();
      })
      .subscribe();
    return () => {
      void client.removeChannel(channel);
    };
  }, [gameRead?.game?.roomId, refresh, token]);

  async function sendAction(action: Action) {
    const game = gameRead?.game;
    if (!game) return;
    setActionId(action.id);
    setError("");
    const commandId = crypto.randomUUID();
    let expectedVersion = game.version;
    try {
      for (let attempt = 0; attempt < 6; attempt++) {
        const response = await fetch(`/api/rooms/${code}/game/commands`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            commandId,
            expectedVersion,
            command: action.command satisfies GameCommand,
          }),
        });
        const result = await response.json();
        if (
          response.status === 409 &&
          typeof result.currentVersion === "number"
        ) {
          const latest = await refresh(result.currentVersion);
          const available = latest?.privateState?.actions.some(
            (candidate) =>
              JSON.stringify(candidate.command) ===
              JSON.stringify(action.command),
          );
          const sameVote =
            action.command.type !== "VOTE" ||
            latest?.game?.publicState.currentNomination?.nomineeId ===
              game.publicState.currentNomination?.nomineeId;
          if (!latest?.game || !available || !sameVote) {
            if (action.command.type === "VOTE") {
              throw new Error(
                sameVote
                  ? "This vote action is no longer available in the current state. Check the refreshed vote to see whether your hand was counted."
                  : "That nomination has finished. The current game state has been refreshed.",
              );
            }
            throw new Error(
              "The game changed while your action was being submitted. We refreshed the game; please check the current vote and try again if the action is still available.",
            );
          }
          expectedVersion = latest.game.version;
          await new Promise((resolve) =>
            window.setTimeout(resolve, 50 + attempt * 40),
          );
          continue;
        }
        if (!response.ok)
          throw new Error(
            result.error ?? "That action could not be submitted.",
          );
        await refresh(typeof result.version === "number" ? result.version : 0);
        return;
      }
      throw new Error(
        "The game is changing quickly. It has been refreshed; please try your action again.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "That action could not be submitted.",
      );
      await refresh();
    } finally {
      setActionId("");
    }
  }

  const game = gameRead?.game;
  const privateView = gameRead?.privateState;
  const publicView = game?.publicState;
  const dayActions =
    game?.phase === "day"
      ? (privateView?.actions.filter(
          (action) =>
            action.command.type === "NOMINATE" ||
            action.command.type === "VOTE" ||
            action.command.type === "ADVANCE_VOTE" ||
            action.command.type === "ADVANCE_NOMINATION" ||
            action.command.type === "OPEN_NOMINATIONS" ||
            action.command.type === "CLOSE_NOMINATIONS",
        ) ?? [])
      : [];
  const roleActions =
    privateView?.actions.filter(
      (action) =>
        action.command.type !== "NOMINATE" &&
        action.command.type !== "VOTE" &&
        action.command.type !== "ADVANCE_VOTE" &&
        action.command.type !== "ADVANCE_NOMINATION" &&
        action.command.type !== "OPEN_NOMINATIONS" &&
        action.command.type !== "CLOSE_NOMINATIONS",
    ) ?? [];
  const discussionSeconds = discussionDeadline
    ? Math.max(0, Math.ceil((discussionDeadline - clockNow) / 1000))
    : 0;
  const discussionClock = `${Math.floor(discussionSeconds / 60)}:${String(discussionSeconds % 60).padStart(2, "0")}`;
  const nominationSeconds = nominationDeadline
    ? Math.max(0, Math.ceil((nominationDeadline - clockNow) / 1000))
    : 0;
  const nominationClock = `${Math.floor(nominationSeconds / 60)}:${String(nominationSeconds % 60).padStart(2, "0")}`;
  const voteCountdownSeconds = voteTurnDeadline
    ? Math.max(0, Math.ceil((voteTurnDeadline - clockNow) / 1000))
    : null;

  return (
    <main className="min-h-screen px-5 py-7 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-4xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href={`/room/${code}`}
            className="inline-flex items-center gap-2 text-sm text-zinc-500 transition hover:text-white"
          >
            <ArrowLeft size={16} /> Room lobby
          </Link>
          <Link
            href={`/room/${code}/script`}
            className="inline-flex items-center gap-2 rounded-lg border border-violet-200/15 bg-violet-300/[0.07] px-3 py-2 text-sm text-violet-100 transition hover:border-violet-200/30 hover:bg-violet-300/[0.12]"
          >
            <BookOpen size={15} /> Script &amp; setup
          </Link>
        </div>

        {!token ? (
          <section className="mt-12 rounded-3xl border border-white/10 bg-[#131720] p-8 text-center">
            <h1 className="text-2xl font-semibold">
              Player session unavailable
            </h1>
            <p className="mt-3 text-sm text-zinc-500">
              Join the room again from this device to continue.
            </p>
            <Link
              href={`/room/${code}`}
              className="mt-6 inline-flex rounded-xl bg-violet-300 px-5 py-3 font-medium text-zinc-950"
            >
              Return to room
            </Link>
          </section>
        ) : loading && !game ? (
          <div className="mt-24 flex items-center justify-center gap-3 text-sm text-zinc-500">
            <LoaderCircle className="animate-spin" size={18} /> Loading your
            private game view…
          </div>
        ) : game ? (
          <>
            <header className="mt-8 flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-xs font-medium tracking-[0.22em] text-violet-200">
                  {game.rulesetId.replaceAll("-", " ")} · {game.rulesetVersion}
                </p>
                <h1 className="mt-2 text-3xl font-semibold capitalize sm:text-4xl">
                  {game.phase}
                  {game.phase === "night" || game.phase === "day"
                    ? ` ${game.dayNumber}`
                    : ""}
                </h1>
              </div>
              <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-zinc-400">
                <MoonStar size={14} className="text-violet-200" /> Version{" "}
                {game.version}
              </div>
            </header>

            {game.phase === "finished" && (
              <section
                className="mt-6 rounded-3xl border border-amber-200/20 bg-gradient-to-br from-amber-200/[0.12] to-[#131720] p-6 sm:p-8"
                role="status"
              >
                <p className="text-xs font-medium tracking-[0.2em] text-amber-100/70">
                  GAME OVER
                </p>
                <h2 className="mt-2 text-3xl font-semibold text-amber-50">
                  {publicView?.headline ?? "The game has ended"}
                </h2>
                <p className="mt-2 text-sm text-zinc-400">
                  The winning team has been decided. Return to the lobby to
                  prepare the next game.
                </p>
                {publicView?.revealedRoles && (
                  <div className="mt-6 rounded-2xl border border-white/10 bg-black/20 p-4 sm:p-5">
                    <h3 className="text-sm font-semibold tracking-wide text-amber-50">
                      Everyone’s roles
                    </h3>
                    <ul className="mt-3 divide-y divide-white/[0.07]">
                      {publicView.revealedRoles.map((player) => (
                        <li
                          key={player.playerId}
                          className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3"
                        >
                          <div className="flex items-center gap-3">
                            <RoleSprite
                              roleName={player.roleName}
                              size={44}
                              className="size-11 shrink-0"
                            />
                            <div>
                              <span className="text-sm font-medium text-zinc-100">
                                {player.displayName}
                                {player.alive ? "" : " · dead"}
                              </span>
                              <p className="mt-0.5 text-xs text-amber-100">
                                {player.roleName}{" "}
                                <span className="text-zinc-500">
                                  · {player.team}
                                </span>
                              </p>
                              {player.believedAs && (
                                <span className="block text-xs text-zinc-500">
                                  Believed they were {player.believedAs}
                                </span>
                              )}
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <Link
                  href={`/room/${code}`}
                  className="mt-5 inline-flex items-center justify-center rounded-xl bg-amber-100 px-5 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-white"
                >
                  Return to lobby
                </Link>
              </section>
            )}

            <section className="mt-6 grid gap-5 lg:grid-cols-[1fr_.9fr]">
              <div className="space-y-5">
                <article className="rounded-3xl border border-white/10 bg-[#131720] p-6 sm:p-7">
                  <div className="flex items-center gap-2 text-xs font-medium tracking-[0.16em] text-zinc-500">
                    <UsersRound size={15} /> THE TOWN
                  </div>
                  <h2 className="mt-4 text-xl font-semibold">
                    {publicView?.headline || "The game is underway"}
                  </h2>
                  <ul className="mt-4 divide-y divide-white/[0.06]">
                    {publicView?.players?.map((player) => (
                      <li
                        key={player.id}
                        aria-current={
                          publicView?.highlightedPlayerId === player.id
                            ? "true"
                            : undefined
                        }
                        className={`grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 rounded-xl px-3 py-3 transition-all duration-300 ${publicView?.highlightedPlayerId === player.id ? "bg-amber-200/15 ring-1 ring-amber-200/70 shadow-[0_0_24px_rgba(253,230,138,0.14)]" : ""}`}
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <span className="flex w-4 shrink-0 justify-center">
                            {player.alive ? (
                              <span className="size-2 rounded-full bg-emerald-300" />
                            ) : (
                              <Skull
                                className={`shrink-0 ${player.hasGhostVote ? "text-violet-200" : "text-zinc-600"}`}
                                size={14}
                              />
                            )}
                          </span>
                          <span
                            className={`truncate text-sm ${player.alive ? "text-zinc-200" : player.hasGhostVote ? "text-violet-200 line-through" : "text-zinc-600 line-through"}`}
                          >
                            {player.displayName}
                          </span>
                        </div>
                        <div className="flex justify-center">
                          {publicView?.highlightedPlayerId === player.id && (
                            <span className="rounded-full bg-amber-100/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-amber-100">
                              {publicView?.nominationStage === "countdown"
                                ? "Starting seat"
                                : "Voting now"}
                            </span>
                          )}
                        </div>
                        <div className="flex justify-end">
                          {publicView?.currentNomination?.nomineeId ===
                          player.id ? (
                            <span className="text-right text-[10px] font-semibold uppercase tracking-wider text-amber-100 sm:text-xs">
                              Nominated
                            </span>
                          ) : publicView?.executionBlock?.nomineeId ===
                            player.id ? (
                            <span className="text-right text-[10px] font-semibold uppercase tracking-wider text-rose-200 sm:text-xs">
                              Marked execution
                            </span>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                  {publicView?.executionBlock && (
                    <div
                      className="mt-4 rounded-xl border border-rose-200/15 bg-rose-200/[0.05] p-4"
                      role="status"
                    >
                      <p className="text-xs uppercase tracking-wider text-rose-100/70">
                        On the block
                      </p>
                      <p className="mt-1 font-medium text-rose-50">
                        {publicView.executionBlock.nomineeName}
                      </p>
                      <p className="mt-1 text-xs text-zinc-400">
                        {publicView.executionBlock.votes} votes. A later
                        nomination needs at least{" "}
                        {Math.max(
                          publicView.executionBlock.votes + 1,
                          publicView.votesRequiredForBlock ?? 1,
                        )}{" "}
                        votes to take the block. The host resolves the final
                        block when nominations close.
                      </p>
                    </div>
                  )}
                  {publicView?.executionBlockTied && (
                    <p className="mt-4 rounded-xl border border-amber-200/10 bg-amber-200/[0.04] p-4 text-sm text-amber-100/80">
                      The leading nomination votes are tied. No one is currently
                      on the block.
                    </p>
                  )}
                  {game.phase === "day" && (
                    <section className="mt-5 rounded-2xl border border-amber-200/15 bg-amber-200/[0.04] p-4">
                      <p className="text-xs font-medium tracking-[0.16em] text-amber-100/70">
                        DAY ACTIONS
                      </p>
                      <h3 className="mt-2 text-lg font-semibold">
                        {publicView?.dayStage === "discussion"
                          ? `Discussion · ${discussionClock}`
                          : publicView?.nominationStage === "accusation"
                            ? `Accusation · ${nominationClock}`
                            : publicView?.nominationStage === "defense"
                              ? `Defence · ${nominationClock}`
                              : publicView?.nominationStage === "countdown"
                                ? `Vote begins · 0:${String(nominationSeconds).padStart(2, "0")}`
                                : publicView?.nominationStage === "voting"
                                  ? `Vote on ${publicView.currentNomination?.nomineeName} · ${voteCountdownSeconds ?? 2}s`
                                  : publicView?.currentNomination
                                    ? `Nomination · ${nominationClock}`
                                    : "Nominations are open"}
                      </h3>
                      {publicView?.dayStage !== "discussion" &&
                        publicView?.votesRequiredForBlock !== undefined && (
                          <p className="mt-1 text-xs text-amber-100/70">
                            {publicView.votesRequiredForBlock} votes from{" "}
                            {publicView.livingPlayerCount} living{" "}
                            {publicView.livingPlayerCount === 1
                              ? "player"
                              : "players"}{" "}
                            are needed to get on the block.
                          </p>
                        )}
                      {publicView?.currentNomination && (
                        <div className="mt-3 rounded-xl border border-amber-200/10 bg-black/10 p-3">
                          <p className="text-xs uppercase tracking-wider text-amber-100/70">
                            Current nomination
                          </p>
                          <p className="mt-1 font-medium">
                            {publicView.currentNomination.nomineeName}
                            {publicView.currentNomination.nominatorName && (
                              <span className="text-xs font-normal text-zinc-400">
                                {" "}
                                · nominated by{" "}
                                {publicView.currentNomination.nominatorName}
                              </span>
                            )}
                            {publicView.nominationStage === "voting" && (
                              <span className="text-xs font-normal text-zinc-400">
                                {" "}
                                · {publicView.currentNomination.votesFor} yes
                              </span>
                            )}
                          </p>
                          {publicView.nominationStage === "accusation" && (
                            <p className="mt-2 text-xs leading-5 text-amber-100/70">
                              {publicView.currentNomination.nominatorName ??
                                "The nominator"}{" "}
                              has one minute to make their accusation.
                            </p>
                          )}
                          {publicView.nominationStage === "defense" && (
                            <p className="mt-2 text-xs leading-5 text-amber-100/70">
                              {publicView.currentNomination.nomineeName} has one
                              minute to defend.
                            </p>
                          )}
                          {publicView.nominationStage === "countdown" && (
                            <p className="mt-2 text-xs leading-5 text-amber-100/70">
                              Voting starts when the countdown ends. The
                              highlighted seat begins the clockwise vote sweep.
                            </p>
                          )}
                          {publicView.nominationStage === "voting" &&
                            publicView.currentVoter && (
                              <p className="mt-2 text-xs leading-5 text-amber-100/70">
                                Voting proceeds clockwise, starting with the
                                nominee. {publicView.currentVoter.displayName}’s
                                highlighted seat passes in{" "}
                                {voteCountdownSeconds ?? 3}s. Raise your hand
                                before the sweep reaches you; a hand left down
                                counts as no.
                              </p>
                            )}
                          {publicView.currentNomination.ballots.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {publicView.currentNomination.ballots.map(
                                (ballot) => (
                                  <span
                                    key={ballot.playerId}
                                    className="rounded-full bg-emerald-300/10 px-2.5 py-1 text-xs text-emerald-200"
                                  >
                                    {ballot.displayName}: Yes
                                  </span>
                                ),
                              )}
                            </div>
                          )}
                        </div>
                      )}
                      <p className="mt-1 text-sm leading-6 text-zinc-400">
                        {privateView?.prompt ??
                          (publicView?.currentNomination
                            ? "Vote on the open nomination before another one begins."
                            : "You cannot nominate while dead. Wait for an alive player to make a nomination.")}
                      </p>
                      {dayActions.length > 0 ? (
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          {dayActions.map((action) => (
                            <button
                              key={action.id}
                              onClick={() => void sendAction(action)}
                              disabled={Boolean(actionId)}
                              className="rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2.5 text-left text-sm text-zinc-200 transition hover:border-amber-100/20 hover:bg-amber-100/[0.08] disabled:opacity-50"
                            >
                              {action.label}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-3 text-xs text-zinc-500">
                          {publicView?.currentNomination
                            ? "No button is needed for a no vote. If your hand is down when the host passes your seat, it counts as no."
                            : "You may have already nominated today. Nominations can also be unavailable while a vote is open."}
                        </p>
                      )}
                    </section>
                  )}
                  {Boolean(publicView?.notices?.length) && (
                    <section
                      aria-label="This night and day log"
                      aria-live="polite"
                      className="mt-5 border-t border-white/[0.06] pt-4"
                    >
                      <h3 className="text-xs font-medium tracking-[0.16em] text-zinc-500">
                        THIS NIGHT &amp; DAY
                      </h3>
                      <ol className="mt-2 space-y-2">
                        {publicView?.notices?.map((notice, index) => (
                          <li
                            key={`${index}-${notice}`}
                            className="text-sm leading-6 text-zinc-400"
                          >
                            {notice.includes(" nominated ") ? (
                              <strong className="font-semibold text-zinc-200">
                                {notice}
                              </strong>
                            ) : (
                              notice
                            )}
                          </li>
                        ))}
                      </ol>
                    </section>
                  )}
                </article>
              </div>

              <aside className="rounded-3xl border border-violet-200/15 bg-gradient-to-br from-violet-300/[0.11] via-[#131720] to-[#131720] p-6 sm:p-7">
                {privateView ? (
                  <>
                    <p className="text-xs font-medium tracking-[0.18em] text-violet-200">
                      YOUR PRIVATE ROLE
                    </p>
                    <div className="mt-3 flex items-center gap-4">
                      <div className="flex size-24 shrink-0 items-center justify-center rounded-2xl border border-violet-200/15 bg-black/20 shadow-inner shadow-black/30">
                        <RoleSprite
                          roleName={privateView.role.name}
                          size={80}
                          className="size-20"
                        />
                      </div>
                      <div>
                        <h2 className="text-3xl font-semibold">
                          {privateView.role.name}
                        </h2>
                        <p className="mt-2 text-sm capitalize text-zinc-400">
                          {privateView.role.team}
                        </p>
                      </div>
                    </div>
                    <p className="mt-5 border-t border-white/10 pt-5 text-sm leading-6 text-zinc-300">
                      {privateView.role.ability}
                    </p>
                    {privateView.information.map((info, index) => (
                      <p
                        key={`${index}-${info}`}
                        className="mt-3 rounded-xl bg-black/20 p-3 text-sm leading-6 text-violet-100/90"
                      >
                        {info}
                      </p>
                    ))}
                    {privateView.prompt && (
                      <p className="mt-5 text-sm font-medium leading-6 text-white">
                        {privateView.prompt}
                      </p>
                    )}
                    {roleActions.length > 0 && (
                      <div className="mt-5 space-y-2">
                        {roleActions.map((action) => (
                          <button
                            key={action.id}
                            onClick={() => void sendAction(action)}
                            disabled={Boolean(actionId)}
                            className="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-300 px-4 py-3 font-semibold text-zinc-950 transition hover:bg-violet-200 disabled:cursor-wait disabled:opacity-50"
                          >
                            {actionId === action.id && (
                              <LoaderCircle
                                className="animate-spin"
                                size={16}
                              />
                            )}
                            {action.label}
                          </button>
                        ))}
                      </div>
                    )}
                    {roleActions.length === 0 && (
                      <p className="mt-5 text-xs text-zinc-600">
                        {game.phase === "day"
                          ? "Your nomination and voting options are shown in the Town panel."
                          : "No action is waiting for you. The app will update this view as the game progresses."}
                      </p>
                    )}
                  </>
                ) : (
                  <div>
                    <p className="text-xs font-medium tracking-[0.18em] text-violet-200">
                      PRIVATE VIEW
                    </p>
                    <h2 className="mt-3 text-2xl font-semibold">
                      Waiting for your information
                    </h2>
                    <p className="mt-3 text-sm leading-6 text-zinc-500">
                      Your role and any private information appear here. They
                      are sent only to your player session.
                    </p>
                  </div>
                )}
              </aside>
            </section>
            {error && (
              <p
                role="alert"
                className="mt-4 rounded-xl border border-rose-300/15 bg-rose-300/[0.06] px-4 py-3 text-sm text-rose-200"
              >
                {error}
              </p>
            )}
          </>
        ) : (
          <section className="mt-12 rounded-3xl border border-white/10 bg-[#131720] p-8 text-center">
            <h1 className="text-2xl font-semibold">No game has started</h1>
            <p className="mt-3 text-sm text-zinc-500">
              {error ||
                "Return to the lobby; the room creator can start when the ruleset is installed and enough players have joined."}
            </p>
            <Link
              href={`/room/${code}`}
              className="mt-6 inline-flex rounded-xl bg-violet-300 px-5 py-3 font-medium text-zinc-950"
            >
              Return to lobby
            </Link>
          </section>
        )}
      </div>
    </main>
  );
}

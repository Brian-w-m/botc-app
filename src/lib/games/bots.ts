import type { AuthoritativeGameState, GameCommand, GameParticipant, GameRuleset, GameTransition } from "@/domain/game/types";

type BotPlayer = { id: string; name: string; isHost: boolean; isBot: boolean; alive: boolean; ghostVote: boolean };
type BotState = {
  phase: string;
  dayStage?: string | null;
  current: { playerId: string } | null;
  currentNominee: string | null;
  currentVoterId?: string | null;
  order?: string[];
  voteOrder?: string[];
  voteChoices?: Record<string, string>;
  nominatedBy?: string[];
  botNominationsDecided?: string[];
  botVotesDecided?: string[];
  votes: Record<string, boolean>;
  players: BotPlayer[];
  botActionDueAt?: number;
};
export type AutomatedAction = { actorId: string; command: GameCommand };

function currentVotePlayerId(state: BotState) {
  if (state.currentVoterId) return state.currentVoterId;
  if (!state.currentNominee) return null;
  const seat = state.order?.indexOf(state.currentNominee) ?? -1;
  const order = state.voteOrder?.length ? state.voteOrder : seat >= 0
    ? [...(state.order ?? []).slice(seat), ...(state.order ?? []).slice(0, seat)]
    : [];
  const choices = state.voteChoices ?? Object.fromEntries(Object.entries(state.votes ?? {}).map(([id, vote]) => [id, vote ? "yes" : "no"]));
  return order.find(id => {
    const voter = state.players.find(player => player.id === id);
    return voter && !Object.hasOwn(choices, id) && (voter.alive || voter.ghostVote);
  }) ?? null;
}

function nextBot(game: AuthoritativeGameState) {
  const internal = game.secretState as unknown as BotState;
  const bots = internal.players.filter(player => player.isBot);
  if (internal.phase === "night") {
    const bot = bots.find(player => player.id === internal.current?.playerId);
    return bot ? { bot, mode: "night" as const } : null;
  }
  if (internal.phase !== "day") return null;
  if (internal.currentNominee) {
    const currentVoterId = currentVotePlayerId(internal);
    const bot = bots.find(player => player.id === currentVoterId && !internal.botVotesDecided?.includes(player.id) && (player.alive || player.ghostVote));
    return bot ? { bot, mode: "vote" as const } : null;
  }
  if ((internal.dayStage ?? "nominations") === "nominations") {
    const bot = bots.find(player => player.alive
      && !internal.nominatedBy?.includes(player.id)
      && !internal.botNominationsDecided?.includes(player.id));
    return bot ? { bot, mode: "nomination" as const } : null;
  }
  return null;
}

function availableChoices(ruleset: GameRuleset, game: AuthoritativeGameState, bot: BotPlayer, mode: "night" | "vote" | "nomination") {
  const view = ruleset.projectPrivateState(game.secretState, bot.id);
  const type = mode === "night" ? "NIGHT_CHOOSE" : mode === "vote" ? "VOTE" : "NOMINATE";
  return view?.actions.filter(action => action.command.type === type) ?? [];
}

export function scheduleBotAction(ruleset: GameRuleset, game: AuthoritativeGameState, dueAt: number): AuthoritativeGameState {
  const internal = JSON.parse(JSON.stringify(game.secretState)) as BotState;
  const next = nextBot({ ...game, secretState: internal as unknown as AuthoritativeGameState["secretState"] });
  if (next && (next.mode === "nomination" || availableChoices(ruleset, game, next.bot, next.mode).length > 0)) {
    internal.botActionDueAt = next.mode === "vote" ? Math.min(dueAt, Date.now() + 1000) : dueAt;
  } else {
    delete internal.botActionDueAt;
  }
  return { ...game, secretState: internal as unknown as AuthoritativeGameState["secretState"] };
}

export function hasBotAction(ruleset: GameRuleset, game: AuthoritativeGameState): boolean {
  const next = nextBot(game);
  return Boolean(next && (next.mode === "nomination" || availableChoices(ruleset, game, next.bot, next.mode).length > 0));
}

export function botActionDueAt(game: AuthoritativeGameState): number | null {
  const value = (game.secretState as unknown as BotState).botActionDueAt;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function runNextBotAction(ruleset: GameRuleset, game: AuthoritativeGameState, random: () => number): { state: AuthoritativeGameState; action: AutomatedAction; transition: GameTransition } | null {
  const next = nextBot(game);
  if (!next) return null;
  const choices = availableChoices(ruleset, game, next.bot, next.mode);
  let selected: (typeof choices)[number] | undefined;
  if (next.mode === "nomination" && random() >= 0.5) {
    selected = { id: "bot-pass", label: "Pass on nominating", command: { type: "BOT_SKIP_NOMINATION" } };
  } else if (choices.length > 0) {
    selected = choices[Math.floor(random() * choices.length)];
  } else if (next.mode === "nomination") {
    selected = { id: "bot-pass", label: "Pass on nominating", command: { type: "BOT_SKIP_NOMINATION" } };
  }
  if (!selected) return null;

  const participant: GameParticipant = {
    id: next.bot.id,
    displayName: next.bot.name,
    isHost: next.bot.isHost,
    isBot: true
  };
  const transition = ruleset.applyCommand(game, participant, selected.command, random);
  return {
    state: transition.state,
    action: { actorId: next.bot.id, command: selected.command },
    transition
  };
}

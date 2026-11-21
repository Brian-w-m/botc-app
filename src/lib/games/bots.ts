import type { AuthoritativeGameState, GameCommand, GameParticipant, GameRuleset, GameTransition } from "@/domain/game/types";

type BotPlayer = { id: string; name: string; isHost: boolean; isBot: boolean; alive: boolean; ghostVote: boolean };
type BotState = {
  phase: string;
  dayStage?: string | null;
  current: { playerId: string } | null;
  currentNominee: string | null;
  nominatedBy?: string[];
  botNominationsDecided?: string[];
  votes: Record<string, boolean>;
  players: BotPlayer[];
  botActionDueAt?: number;
};
export type AutomatedAction = { actorId: string; command: GameCommand };

function nextBot(game: AuthoritativeGameState) {
  const internal = game.secretState as unknown as BotState;
  const bots = internal.players.filter(player => player.isBot);
  if (internal.phase === "night") {
    const bot = bots.find(player => player.id === internal.current?.playerId);
    return bot ? { bot, mode: "night" as const } : null;
  }
  if (internal.phase !== "day") return null;
  if (internal.currentNominee) {
    const bot = bots.find(player => (player.alive || player.ghostVote) && !Object.hasOwn(internal.votes, player.id));
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
    internal.botActionDueAt = dueAt;
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

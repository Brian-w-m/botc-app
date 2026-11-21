export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type GamePhase = "setup" | "night" | "day" | "finished";

export interface GameParticipant {
  id: string;
  displayName: string;
  isHost: boolean;
  isBot?: boolean;
}

export interface PublicGameView {
  headline: string;
  dayStage?: "discussion" | "nominations" | null;
  discussionEndsAt?: number | null;
  players: Array<{
    id: string;
    displayName: string;
    alive: boolean;
    hasGhostVote: boolean;
  }>;
  currentNomination: { nomineeId: string; nomineeName: string; votesFor: number; ballots: Array<{ playerId: string; displayName: string; vote: boolean }> } | null;
  executionBlock?: { nomineeId: string; nomineeName: string; votes: number } | null;
  executionBlockTied?: boolean;
  livingPlayerCount?: number;
  votesRequiredForBlock?: number;
  notices: string[];
  revealedRoles?: Array<{
    playerId: string;
    displayName: string;
    roleName: string;
    team: string;
    alive: boolean;
    believedAs?: string;
  }>;
}

export interface PlayerPrivateView {
  role: { id: string; name: string; team: string; ability: string };
  information: string[];
  prompt: string | null;
  actions: Array<{ id: string; label: string; command: GameCommand }>;
}

/** This object is server-owned. `secretState` must never be returned to a client. */
export interface AuthoritativeGameState {
  phase: GamePhase;
  dayNumber: number;
  publicState: JsonValue;
  secretState: JsonValue;
}

export interface GameCommand {
  type: string;
  [key: string]: JsonValue;
}

export interface GameTransition {
  state: AuthoritativeGameState;
  eventType: string;
  eventPayload: JsonValue;
}

export class GameCommandError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "GameCommandError";
  }
}

/**
 * A ruleset implementation runs on the server. The client supplies commands,
 * never initialized state, role assignments, or resolution outcomes.
 */
export interface GameRuleset {
  id: string;
  version: string;
  minPlayers: number;
  maxPlayers: number;
  createInitialState(
    participants: GameParticipant[],
    random: () => number
  ): AuthoritativeGameState;
  applyCommand(
    state: AuthoritativeGameState,
    actor: GameParticipant,
    command: GameCommand,
    random: () => number
  ): GameTransition;
  projectPublicState(secretState: JsonValue): JsonValue;
  projectPrivateState(secretState: JsonValue, playerId: string): PlayerPrivateView | null;
}

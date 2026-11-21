/** Generic original prototype types. No licensed script or character data belongs here. */
export type GamePhase = "lobby" | "night" | "day" | "finished";
export type Team = "town" | "outsider" | "adversary" | "neutral";

export interface Player {
  id: string;
  displayName: string;
  alive: boolean;
  hasGhostVote: boolean;
}

export interface PublicGameState {
  gameId: string;
  version: number;
  phase: GamePhase;
  players: Player[];
  dayNumber: number;
}

export type GameCommand =
  | { type: "START_GAME" }
  | { type: "BEGIN_DAY" }
  | { type: "BEGIN_NIGHT" }
  | { type: "PLAYER_DIED"; playerId: string }
  | { type: "FINISH_GAME" };

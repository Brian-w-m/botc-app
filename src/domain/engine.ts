import type { GameCommand, PublicGameState } from "./types";

export type EngineErrorCode =
  | "GAME_ALREADY_STARTED"
  | "GAME_NOT_STARTED"
  | "INVALID_PHASE"
  | "PLAYER_NOT_FOUND"
  | "PLAYER_ALREADY_DEAD"
  | "GAME_FINISHED";

export class EngineError extends Error {
  constructor(
    public readonly code: EngineErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "EngineError";
  }
}

/**
 * Pure transition function: no I/O, clock, random values, or framework dependencies.
 * Callers must persist the returned state transactionally and check the prior version.
 */
export function transition(
  state: PublicGameState,
  command: GameCommand,
): PublicGameState {
  if (state.phase === "finished")
    throw new EngineError("GAME_FINISHED", "This game has finished.");

  switch (command.type) {
    case "START_GAME":
      if (state.phase !== "lobby")
        throw new EngineError(
          "GAME_ALREADY_STARTED",
          "The game has already started.",
        );
      if (state.players.length < 4)
        throw new EngineError(
          "INVALID_PHASE",
          "At least four players are required to start.",
        );
      return {
        ...state,
        phase: "night",
        dayNumber: 1,
        version: state.version + 1,
      };

    case "BEGIN_DAY":
      if (state.phase !== "night")
        throw new EngineError(
          "INVALID_PHASE",
          "Day can only begin after night.",
        );
      return { ...state, phase: "day", version: state.version + 1 };

    case "BEGIN_NIGHT":
      if (state.phase !== "day")
        throw new EngineError(
          "INVALID_PHASE",
          "Night can only begin after day.",
        );
      return {
        ...state,
        phase: "night",
        dayNumber: state.dayNumber + 1,
        version: state.version + 1,
      };

    case "PLAYER_DIED": {
      if (state.phase === "lobby")
        throw new EngineError("GAME_NOT_STARTED", "The game has not started.");
      const player = state.players.find((p) => p.id === command.playerId);
      if (!player)
        throw new EngineError("PLAYER_NOT_FOUND", "Player not found.");
      if (!player.alive)
        throw new EngineError("PLAYER_ALREADY_DEAD", "Player is already dead.");
      return {
        ...state,
        version: state.version + 1,
        players: state.players.map((p) =>
          p.id === command.playerId ? { ...p, alive: false } : p,
        ),
      };
    }

    case "FINISH_GAME":
      if (state.phase === "lobby")
        throw new EngineError("GAME_NOT_STARTED", "The game has not started.");
      return { ...state, phase: "finished", version: state.version + 1 };
  }
}

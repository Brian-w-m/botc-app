import { describe, expect, it } from "vitest";
import { EngineError, transition } from "./engine";
import type { PublicGameState } from "./types";

const initial: PublicGameState = {
  gameId: "game-1", version: 0, phase: "lobby", dayNumber: 0,
  players: [
    { id: "p1", displayName: "A", alive: true, hasGhostVote: true },
    { id: "p2", displayName: "B", alive: true, hasGhostVote: true },
    { id: "p3", displayName: "C", alive: true, hasGhostVote: true },
    { id: "p4", displayName: "D", alive: true, hasGhostVote: true }
  ]
};

describe("game state transitions", () => {
  it("starts only when the minimum player count is met", () => {
    expect(transition(initial, { type: "START_GAME" })).toMatchObject({ phase: "night", dayNumber: 1, version: 1 });
    expect(() => transition({ ...initial, players: initial.players.slice(0, 3) }, { type: "START_GAME" }))
      .toThrowError(EngineError);
  });

  it("moves between night and day and increments the day on each new night", () => {
    const night = transition(initial, { type: "START_GAME" });
    const day = transition(night, { type: "BEGIN_DAY" });
    const nextNight = transition(day, { type: "BEGIN_NIGHT" });
    expect(day.phase).toBe("day");
    expect(nextNight).toMatchObject({ phase: "night", dayNumber: 2, version: 3 });
  });

  it("marks a living player dead without mutating the input state", () => {
    const night = transition(initial, { type: "START_GAME" });
    const dead = transition(night, { type: "PLAYER_DIED", playerId: "p2" });
    expect(dead.players.find(p => p.id === "p2")?.alive).toBe(false);
    expect(night.players.find(p => p.id === "p2")?.alive).toBe(true);
  });

  it("rejects unknown and already-dead players", () => {
    const night = transition(initial, { type: "START_GAME" });
    expect(() => transition(night, { type: "PLAYER_DIED", playerId: "missing" }))
      .toThrowError(expect.objectContaining({ code: "PLAYER_NOT_FOUND" }));
    const dead = transition(night, { type: "PLAYER_DIED", playerId: "p1" });
    expect(() => transition(dead, { type: "PLAYER_DIED", playerId: "p1" }))
      .toThrowError(expect.objectContaining({ code: "PLAYER_ALREADY_DEAD" }));
  });

  it("does not allow day to begin from lobby", () => {
    expect(() => transition(initial, { type: "BEGIN_DAY" }))
      .toThrowError(expect.objectContaining({ code: "INVALID_PHASE" }));
  });

  it("does not allow commands after game completion", () => {
    const night = transition(initial, { type: "START_GAME" });
    const finished = transition(night, { type: "FINISH_GAME" });
    expect(finished.phase).toBe("finished");
    expect(() => transition(finished, { type: "BEGIN_DAY" }))
      .toThrowError(expect.objectContaining({ code: "GAME_FINISHED" }));
  });

  it("increments version for each accepted command", () => {
    const night = transition(initial, { type: "START_GAME" });
    expect(night.version).toBe(initial.version + 1);
  });
});

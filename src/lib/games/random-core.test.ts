import { describe, expect, it } from "vitest";
import { createSeededRandom } from "./random-core";

describe("seeded game randomness", () => {
  it("replays the same sequence for the same seed", () => {
    const first = createSeededRandom("game-seed");
    const replay = createSeededRandom("game-seed");
    expect(Array.from({ length: 12 }, first)).toEqual(Array.from({ length: 12 }, replay));
  });

  it("produces values in the half-open unit interval", () => {
    const random = createSeededRandom("bounded-seed");
    for (let index = 0; index < 500; index++) {
      const value = random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("changes its sequence when the seed changes", () => {
    const left = createSeededRandom("seed-a");
    const right = createSeededRandom("seed-b");
    expect(Array.from({ length: 8 }, left)).not.toEqual(Array.from({ length: 8 }, right));
  });
});

import "server-only";
import { randomBytes } from "node:crypto";
export { createSeededRandom } from "@/lib/games/random-core";

export function createGameRandomSeed() {
  return randomBytes(32).toString("hex");
}


import "server-only";
import type { GameRuleset } from "@/domain/game/types";
import { installedRulesets } from "@/lib/games/installed-rulesets";

const rulesets = new Map<string, GameRuleset>();

for (const ruleset of installedRulesets) {
  rulesets.set(ruleset.id, ruleset);
}

export function registerRuleset(ruleset: GameRuleset) {
  const current = rulesets.get(ruleset.id);
  if (current && current.version !== ruleset.version) {
    throw new Error(
      `Ruleset ${ruleset.id} is already registered at version ${current.version}.`,
    );
  }
  rulesets.set(ruleset.id, ruleset);
}

export function getRuleset(id: string) {
  return rulesets.get(id) ?? null;
}

export const TROUBLE_BREWING_RULESET_ID = "trouble-brewing";

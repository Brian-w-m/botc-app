import type { GameRuleset } from "@/domain/game/types";
import { troubleBrewing } from "@/lib/games/trouble-brewing";

/**
 * Add rights-cleared server-side ruleset implementations here. Keep this list
 * empty until the approved content and its tested resolution code are available.
 */
export const installedRulesets: GameRuleset[] = [troubleBrewing];

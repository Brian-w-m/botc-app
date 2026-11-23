import { describe, expect, it } from "vitest";
import type { AuthoritativeGameState, GameParticipant, JsonValue } from "@/domain/game/types";
import { troubleBrewing } from "@/lib/games/trouble-brewing";
import { hasBotAction, runNextBotAction, scheduleBotAction } from "@/lib/games/bots";

type TestPlayer = {
  id: string;
  name: string;
  isHost: boolean;
  isBot: boolean;
  alive: boolean;
  role: string;
  realRole: string;
  team: "Townsfolk" | "Outsider" | "Minion" | "Demon";
  poisoned: boolean;
  poisonedBy?: string;
  onceUsed: boolean;
  ghostVote: boolean;
  info: string[];
  redHerring: boolean;
};
type TestSecret = {
  players: TestPlayer[];
  order: string[];
  day: number;
  phase: "night" | "day" | "finished";
  dayStage: "discussion" | "nominations" | null;
  firstNight: boolean;
  queue: Array<{ playerId: string; kind: string }>;
  current: { playerId: string; kind: string } | null;
  nightPicks: Record<string, string[]>;
  priorExecution: string | null;
  executedToday: boolean;
  nominations: string[];
  nominationResults: Array<{ nomineeId: string; votes: number }>;
  executionBlock: string | null;
  executionBlockVotes: number;
  executionBlockTied: boolean;
  nominatedBy: string[];
  botNominationsDecided: string[];
  botVotesDecided?: string[];
  votes: Record<string, boolean>;
  voteChoices: Record<string, "yes" | "no" | "abstain">;
  voteOrder: string[];
  currentVoterId: string | null;
  voteCursor?: number;
  voteTurnEndsAt?: number | null;
  currentNominee: string | null;
  virginSpent: boolean;
  notices: string[];
  winner: string | null;
};
const teams: Record<string, TestPlayer["team"]> = {
  washerwoman:"Townsfolk", librarian:"Townsfolk", investigator:"Townsfolk", chef:"Townsfolk", empath:"Townsfolk", "fortune-teller":"Townsfolk", undertaker:"Townsfolk", monk:"Townsfolk", ravenkeeper:"Townsfolk", virgin:"Townsfolk", slayer:"Townsfolk", soldier:"Townsfolk", mayor:"Townsfolk", butler:"Outsider", drunk:"Outsider", recluse:"Outsider", saint:"Outsider", poisoner:"Minion", spy:"Minion", baron:"Minion", "scarlet-woman":"Minion", imp:"Demon"
};

function makeGame(roleIds: string[], botIds: string[] = []) {
  const participants: GameParticipant[] = roleIds.map((_, index) => ({
    id: `p${index}`,
    displayName: `Player ${index}`,
    isHost: index === 0,
    isBot: botIds.includes(`p${index}`)
  }));
  const initial = troubleBrewing.createInitialState(participants, () => 0.31);
  const secret = JSON.parse(JSON.stringify(initial.secretState)) as TestSecret;
  secret.players.forEach((player, index) => {
    const role = roleIds[index];
    player.realRole = role;
    player.role = role;
    player.team = teams[role];
    player.alive = true;
    player.poisoned = false;
    delete player.poisonedBy;
    player.onceUsed = false;
    player.info = [];
  });
  secret.order = secret.players.map(player => player.id);
  secret.day = 1;
  secret.phase = "night";
  secret.dayStage = null;
  secret.firstNight = false;
  secret.queue = [];
  secret.current = null;
  secret.nightPicks = {};
  secret.priorExecution = null;
  secret.executedToday = false;
  secret.nominations = [];
  secret.nominationResults = [];
  secret.executionBlock = null;
  secret.executionBlockVotes = 0;
  secret.executionBlockTied = false;
  secret.nominatedBy = [];
  secret.botNominationsDecided = [];
  secret.votes = {};
  secret.voteChoices = {};
  secret.voteOrder = [];
  secret.currentVoterId = null;
  secret.voteCursor = 0;
  secret.currentNominee = null;
  secret.virginSpent = false;
  secret.notices = [];
  secret.winner = null;
  return secret;
}

function asGame(secret: TestSecret): AuthoritativeGameState {
  return { phase: secret.phase, dayNumber: secret.day, publicState: null, secretState: secret as unknown as JsonValue };
}
function beginVote(secret: TestSecret, nomineeId: string) {
  secret.currentNominee = nomineeId;
  const nomineeSeat = secret.order.indexOf(nomineeId);
  secret.voteOrder = secret.order.slice(nomineeSeat).concat(secret.order.slice(0, nomineeSeat));
  secret.voteChoices = {};
  secret.votes = {};
  secret.currentVoterId = secret.voteOrder.find(id => {
    const player = secret.players.find(candidate => candidate.id === id)!;
    return player.alive || player.ghostVote;
  }) ?? null;
  secret.voteCursor = secret.voteOrder.findIndex(id => id === secret.currentVoterId);
}
function passVoteSweep(secret: TestSecret) {
  const host = secret.players.find(player => player.isHost)!;
  while (secret.currentNominee) {
    secret.voteTurnEndsAt = 0;
    const transition = troubleBrewing.applyCommand(asGame(secret), actor(host), { type: "ADVANCE_VOTE" }, () => 0.4);
    Object.assign(secret, JSON.parse(JSON.stringify(transition.state.secretState)) as TestSecret);
  }
}
function raiseSelectedHandsAndPass(secret: TestSecret, yesVoters: string[]) {
  for (const id of yesVoters) {
    const voter = secret.players.find(player => player.id === id)!;
    const transition = troubleBrewing.applyCommand(asGame(secret), actor(voter), { type: "VOTE", vote: true }, () => 0.4);
    Object.assign(secret, JSON.parse(JSON.stringify(transition.state.secretState)) as TestSecret);
  }
  passVoteSweep(secret);
}
function actor(player: TestPlayer): GameParticipant {
  return { id: player.id, displayName: player.name, isHost: player.isHost, isBot: player.isBot };
}

describe("Trouble Brewing character audit", () => {
  it.each(["sober", "drunk"] as const)("keeps the Washerwoman out of their own %s information pair", state => {
    const secret = makeGame([state === "sober" ? "washerwoman" : "drunk", "poisoner", "imp", "baron", "librarian"]);
    const washerwoman = secret.players[0];
    const poisoner = secret.players[1];
    if (state === "drunk") washerwoman.role = "washerwoman";
    secret.firstNight = true;
    secret.current = { playerId: poisoner.id, kind: "poisoner" };
    secret.queue = [{ playerId: washerwoman.id, kind: "washerwoman" }];

    const result = troubleBrewing.applyCommand(asGame(secret), actor(poisoner), { type: "NIGHT_CHOOSE", targetPlayerId: secret.players[2].id }, () => 0.4);
    const updated = JSON.parse(JSON.stringify(result.state.secretState)) as TestSecret;
    const info = updated.players[0].info.find(value => value.includes(" is the "));
    const shownPlayers = info?.match(/Player \d+/g) ?? [];
    expect(info).toBeTruthy();
    expect(shownPlayers).toHaveLength(2);
    expect(new Set(shownPlayers).size).toBe(2);
    expect(shownPlayers).not.toContain("Player 0");
  });

  it("ends a Poisoner's ongoing poison as soon as the Poisoner dies", () => {
    const secret = makeGame(["imp", "washerwoman", "empath", "baron", "poisoner", "saint", "undertaker"]);
    const imp = secret.players[0];
    const empath = secret.players[2];
    const poisoner = secret.players[4];
    secret.current = { playerId: poisoner.id, kind: "poisoner" };
    secret.queue = [{ playerId: imp.id, kind: "imp" }];

    const poisoned = troubleBrewing.applyCommand(asGame(secret), actor(poisoner), { type: "NIGHT_CHOOSE", targetPlayerId: empath.id }, () => 0.4);
    const poisonedState = JSON.parse(JSON.stringify(poisoned.state.secretState)) as TestSecret;
    expect(poisonedState.players[2].poisoned).toBe(true);
    expect(poisonedState.current).toMatchObject({ playerId: imp.id, kind: "imp" });

    const killed = troubleBrewing.applyCommand(asGame(poisonedState), actor(imp), { type: "NIGHT_CHOOSE", targetPlayerId: poisoner.id }, () => 0.4);
    const afterDeath = JSON.parse(JSON.stringify(killed.state.secretState)) as TestSecret;
    expect(afterDeath.players[4].alive).toBe(false);
    expect(afterDeath.players[2].poisoned).toBe(false);
    expect(afterDeath.players[2].poisonedBy).toBeUndefined();
  });

  it("ends Monk protection when the Monk is dead", () => {
    const secret = makeGame(["imp", "monk", "empath", "baron", "saint"]);
    secret.nightPicks[secret.players[1].id] = [secret.players[2].id];
    secret.players[1].alive = false;
    secret.current = { playerId: secret.players[0].id, kind: "imp" };

    const result = troubleBrewing.applyCommand(asGame(secret), actor(secret.players[0]), { type: "NIGHT_CHOOSE", targetPlayerId: secret.players[2].id }, () => 0.4);
    const updated = JSON.parse(JSON.stringify(result.state.secretState)) as TestSecret;
    expect(updated.players[2].alive).toBe(false);
  });

  it("has a player-facing ability for every Trouble Brewing character", () => {
    const characters = Object.keys(teams);
    const secret = makeGame(["washerwoman", "librarian", "imp", "baron", "saint"]);
    characters.forEach(character => {
      secret.players[0].role = character;
      const view = troubleBrewing.projectPrivateState(secret as unknown as JsonValue, secret.players[0].id);
      expect(view?.role.ability, character).toBeTruthy();
    });
  });

  it("does not give an Undertaker information if the Imp kills them before their turn", () => {
    const secret = makeGame(["imp", "undertaker", "empath", "fortune-teller", "poisoner", "baron", "saint"]);
    const imp = secret.players[0];
    const undertaker = secret.players[1];
    secret.priorExecution = secret.players[6].id;
    secret.current = { playerId: imp.id, kind: "imp" };
    secret.queue = [{ playerId: undertaker.id, kind: "undertaker" }];
    const result = troubleBrewing.applyCommand(asGame(secret), actor(imp), { type: "NIGHT_CHOOSE", targetPlayerId: undertaker.id }, () => 0.4);
    const updated = JSON.parse(JSON.stringify(result.state.secretState)) as TestSecret;
    expect(updated.players[1].alive).toBe(false);
    expect(updated.players[1].info.some(info => info.startsWith("Undertaker"))).toBe(false);
  });

  it("does not wake a Fortune Teller killed before their turn", () => {
    const secret = makeGame(["imp", "washerwoman", "empath", "fortune-teller", "poisoner", "baron", "saint"]);
    const imp = secret.players[0];
    const fortuneTeller = secret.players[3];
    secret.current = { playerId: imp.id, kind: "imp" };

    const result = troubleBrewing.applyCommand(asGame(secret), actor(imp), { type: "NIGHT_CHOOSE", targetPlayerId: fortuneTeller.id }, () => 0.4);
    const updated = JSON.parse(JSON.stringify(result.state.secretState)) as TestSecret;
    expect(updated.players[3].alive).toBe(false);
    expect(updated.players[3].info.some(info => info.startsWith("Fortune Teller"))).toBe(false);
    expect(updated.current?.playerId).not.toBe(fortuneTeller.id);
  });

  it("ends the game for evil when a sober Saint is executed", () => {
    const secret = makeGame(["washerwoman", "librarian", "imp", "baron", "saint"]);
    secret.phase = "day";
    secret.dayStage = "nominations";
    secret.executionBlock = secret.players[4].id;
    secret.executionBlockVotes = 3;

    const result = troubleBrewing.applyCommand(asGame(secret), actor(secret.players[0]), { type: "CLOSE_NOMINATIONS" }, () => 0.4);
    expect(result.state.phase).toBe("finished");
    expect((result.state.secretState as unknown as TestSecret).winner).toBe("Evil");
  });

  it("resets the public log at dawn and keeps the new night result plus the day events", () => {
    const secret = makeGame(["imp", "washerwoman", "empath", "baron", "saint"]);
    const imp = secret.players[0];
    secret.notices = ["Old day: Player 4 was nominated.", "Old day: the vote ended."];
    secret.phase = "day";
    secret.dayStage = "nominations";
    const nightStarted = troubleBrewing.applyCommand(asGame(secret), actor(secret.players[0]), { type: "CLOSE_NOMINATIONS" }, () => 0.4);
    expect(nightStarted.state.phase).toBe("night");
    expect((nightStarted.state.secretState as unknown as TestSecret).notices).toEqual(["Old day: Player 4 was nominated.", "Old day: the vote ended.", "No execution occurs today."]);
    const result = troubleBrewing.applyCommand(nightStarted.state, actor(imp), { type: "NIGHT_CHOOSE", targetPlayerId: secret.players[4].id }, () => 0.4);
    const publicView = troubleBrewing.projectPublicState(result.state.secretState) as unknown as { notices: string[] };
    expect(result.state.phase).toBe("day");
    expect(publicView.notices).toEqual(["Player 4 died during the night.", "The town gathers. Discussion begins."]);

    const currentDay = result.state.secretState as unknown as TestSecret;
    currentDay.notices.push("Player 2 nominated Player 3.");
    const nextProjection = troubleBrewing.projectPublicState(currentDay as unknown as JsonValue) as unknown as { notices: string[] };
    expect(nextProjection.notices).toContain("Player 2 nominated Player 3.");
    expect(nextProjection.notices).not.toContain("Old day: Player 4 was nominated.");
  });

  it("wakes a Ravenkeeper after the Imp kills them and lets them choose themself", () => {
    const secret = makeGame(["imp", "ravenkeeper", "empath", "fortune-teller", "poisoner", "baron", "saint"]);
    const imp = secret.players[0];
    const ravenkeeper = secret.players[1];
    secret.current = { playerId: imp.id, kind: "imp" };
    const result = troubleBrewing.applyCommand(asGame(secret), actor(imp), { type: "NIGHT_CHOOSE", targetPlayerId: ravenkeeper.id }, () => 0.4);
    const updated = JSON.parse(JSON.stringify(result.state.secretState)) as TestSecret;
    expect(updated.current).toMatchObject({ playerId: ravenkeeper.id, kind: "ravenkeeper" });
    const view = troubleBrewing.projectPrivateState(result.state.secretState, ravenkeeper.id);
    expect(view?.actions).toContainEqual(expect.objectContaining({ command: expect.objectContaining({ targetPlayerId: ravenkeeper.id }) }));
  });

  it("ends the game for good when a sober Mayor closes a no-execution day at three alive", () => {
    const secret = makeGame(["mayor", "imp", "baron", "saint", "poisoner"]);
    secret.phase = "day";
    secret.dayStage = "nominations";
    secret.players[3].alive = false;
    secret.players[4].alive = false;
    const result = troubleBrewing.applyCommand(asGame(secret), actor(secret.players[0]), { type: "CLOSE_NOMINATIONS" }, () => 0.4);
    expect(result.state.phase).toBe("finished");
    expect((result.state.secretState as unknown as TestSecret).winner).toBe("Good");
  });

  it("presents a Drunk's believed Townsfolk role and makes the action available without letting it work", () => {
    const secret = makeGame(["drunk", "imp", "baron", "saint", "poisoner"]);
    const drunk = secret.players[0];
    drunk.role = "fortune-teller";
    secret.current = { playerId: drunk.id, kind: "fortune-teller" };
    const view = troubleBrewing.projectPrivateState(asGame(secret).secretState, drunk.id);
    expect(view?.role).toMatchObject({ name: "Fortune Teller", team: "Townsfolk" });
    expect(view?.actions.some(action => action.command.type === "NIGHT_CHOOSE")).toBe(true);
  });

  it("offers bot nomination choices and schedules a bot turn instead of resolving it instantly", () => {
    const secret = makeGame(["washerwoman", "librarian", "imp", "baron", "saint"], ["p1"]);
    secret.phase = "day";
    secret.dayStage = "nominations";
    const game = asGame(secret);
    expect(hasBotAction(troubleBrewing, game)).toBe(true);
    const scheduled = scheduleBotAction(troubleBrewing, game, 5000);
    expect((scheduled.secretState as unknown as { botActionDueAt: number }).botActionDueAt).toBe(5000);
    const action = runNextBotAction(troubleBrewing, game, () => 0);
    expect(["NOMINATE", "BOT_SKIP_NOMINATION"]).toContain(action?.action.command.type);
  });

  it("shows public nomination, ballot, death, and final role data in the projections consumed by the UI", () => {
    const secret = makeGame(["washerwoman", "librarian", "imp", "baron", "saint"]);
    secret.phase = "day";
    secret.dayStage = "nominations";
    secret.players[4].alive = false;
    secret.currentNominee = secret.players[4].id;
    secret.votes = { [secret.players[0].id]: true };
    secret.notices = ["Player 0 voted yes on Player 4."];
    const publicView = troubleBrewing.projectPublicState(secret as unknown as JsonValue) as unknown as {
      players: Array<{ displayName: string; alive: boolean; hasGhostVote: boolean }>;
      currentNomination: { nomineeName: string; votesFor: number; ballots: Array<{ displayName: string; vote: boolean | null }> };
      revealedRoles?: unknown[];
      notices: string[];
    };
    expect(publicView.players[4]).toMatchObject({ displayName: "Player 4", alive: false, hasGhostVote: true });
    expect(publicView.currentNomination).toMatchObject({ nomineeName: "Player 4", votesFor: 1 });
    expect(publicView.currentNomination.ballots).toContainEqual(expect.objectContaining({ displayName: "Player 0", vote: true }));
    expect(publicView.notices).toEqual([]);

    secret.phase = "finished";
    secret.winner = "Good";
    const finished = troubleBrewing.projectPublicState(secret as unknown as JsonValue) as unknown as { revealedRoles?: unknown[] };
    expect(finished.revealedRoles).toHaveLength(5);
  });

  it("lets a Butler keep their hand down for no and rejects yes before their Master votes", () => {
    const secret = makeGame(["butler", "washerwoman", "imp", "baron", "saint"]);
    secret.phase = "night";
    secret.current = { playerId: secret.players[0].id, kind: "butler" };
    const masterChoice = troubleBrewing.applyCommand(asGame(secret), actor(secret.players[0]), { type: "NIGHT_CHOOSE", targetPlayerId: secret.players[1].id }, () => 0.4);
    Object.assign(secret, JSON.parse(JSON.stringify(masterChoice.state.secretState)) as TestSecret);
    secret.phase = "day";
    secret.dayStage = "nominations";
    beginVote(secret, secret.players[0].id);
    const voteView = troubleBrewing.projectPrivateState(secret as unknown as JsonValue, secret.players[0].id);
    expect(voteView?.actions.map(action => action.command)).not.toContainEqual({ type: "VOTE", vote: true });
    expect(voteView?.actions.map(action => action.command)).not.toContainEqual({ type: "VOTE", vote: false });
    expect(voteView?.actions.map(action => action.command)).not.toContainEqual({ type: "VOTE", vote: null });
    secret.voteTurnEndsAt = 0;
    const result = troubleBrewing.applyCommand(asGame(secret), actor(secret.players[0]), { type: "ADVANCE_VOTE" }, () => 0.4);
    expect((result.state.secretState as unknown as TestSecret).votes.p0).toBeUndefined();
  });

  it("ends the day immediately when a sober Townsfolk triggers the Virgin", () => {
    const secret = makeGame(["washerwoman", "virgin", "imp", "baron", "saint"]);
    secret.phase = "day";
    secret.dayStage = "nominations";
    const result = troubleBrewing.applyCommand(asGame(secret), actor(secret.players[0]), { type: "NOMINATE", nomineeId: secret.players[1].id }, () => 0.4);
    const updated = result.state.secretState as unknown as TestSecret;
    expect(updated.players[0].alive).toBe(false);
    expect(updated.executedToday).toBe(true);
    expect(result.state.phase).toBe("night");
    expect(updated.notices.some(notice => notice.includes("executed immediately") && notice.includes("Virgin"))).toBe(true);
  });

  it("lets an execution teach the surviving Undertaker and shows that private information in their role panel data", () => {
    const secret = makeGame(["undertaker", "washerwoman", "imp", "baron", "saint"]);
    secret.phase = "day";
    secret.dayStage = "nominations";
    beginVote(secret, secret.players[1].id);
    raiseSelectedHandsAndPass(secret, secret.voteOrder);
    expect(secret.players[1].alive).toBe(true);
    expect(secret.phase).toBe("day");
    expect(secret.executionBlock).toBe(secret.players[1].id);
    expect(secret.notices.some(notice => notice.includes("voted"))).toBe(false);
    expect(secret.notices).toContain("Player 1 is on the block with 5 votes.");
    const close = troubleBrewing.applyCommand(asGame(secret), actor(secret.players[0]), { type: "CLOSE_NOMINATIONS" }, () => 0.4);
    Object.assign(secret, JSON.parse(JSON.stringify(close.state.secretState)) as TestSecret);
    expect(secret.players[1].alive).toBe(false);
    expect(secret.phase).toBe("night");
    expect(secret.current).toMatchObject({ playerId: "p2", kind: "imp" });
    const night = troubleBrewing.applyCommand(asGame(secret), actor(secret.players[2]), { type: "NIGHT_CHOOSE", targetPlayerId: secret.players[4].id }, () => 0.4);
    Object.assign(secret, JSON.parse(JSON.stringify(night.state.secretState)) as TestSecret);
    const undertaker = secret.players[0];
    expect(undertaker.info.some(info => info.includes("Washerwoman"))).toBe(true);
    expect(troubleBrewing.projectPrivateState(secret as unknown as JsonValue, undertaker.id)?.information).toEqual(expect.arrayContaining([expect.stringContaining("Undertaker") ]));
  });

  it("gives the Scarlet Woman the Demon role and info if the Imp dies with at least five alive", () => {
    const secret = makeGame(["imp", "scarlet-woman", "washerwoman", "butler", "saint"]);
    secret.phase = "day";
    secret.dayStage = "nominations";
    beginVote(secret, secret.players[0].id);
    secret.nightPicks[secret.players[3].id] = [secret.players[0].id];
    raiseSelectedHandsAndPass(secret, secret.voteOrder);
    expect(secret.players[0].alive).toBe(true);
    expect(secret.executionBlock).toBe(secret.players[0].id);
    const close = troubleBrewing.applyCommand(asGame(secret), actor(secret.players[0]), { type: "CLOSE_NOMINATIONS" }, () => 0.4);
    Object.assign(secret, JSON.parse(JSON.stringify(close.state.secretState)) as TestSecret);
    expect(secret.players[0].alive).toBe(false);
    expect(secret.players[1]).toMatchObject({ realRole: "imp", team: "Demon" });
    expect(secret.players[1].info.some(info => info.includes("You are now the Imp"))).toBe(true);
    expect(secret.phase).toBe("night");
  });

  it("blocks an execution after an earlier execution has started the night", () => {
    const secret = makeGame(["washerwoman", "librarian", "imp", "baron", "saint"]);
    secret.phase = "day";
    secret.dayStage = "nominations";
    secret.executedToday = true;
    expect(() => troubleBrewing.applyCommand(asGame(secret), actor(secret.players[0]), { type: "NOMINATE", nomineeId: secret.players[1].id }, () => 0.4)).toThrow();
  });

  it("lets a player nominate themself and exposes that nomination to the public table", () => {
    const secret = makeGame(["washerwoman", "librarian", "imp", "baron", "saint"]);
    secret.phase = "day";
    secret.dayStage = "nominations";
    const result = troubleBrewing.applyCommand(asGame(secret), actor(secret.players[0]), { type: "NOMINATE", nomineeId: secret.players[0].id }, () => 0.4);
    const publicView = troubleBrewing.projectPublicState(result.state.secretState) as unknown as { currentNomination: { nomineeName: string } };
    expect(publicView.currentNomination.nomineeName).toBe("Player 0");
    expect(troubleBrewing.projectPrivateState(result.state.secretState, secret.players[0].id)?.actions.some(action => action.command.type === "VOTE")).toBe(true);
  });

  it("collects votes clockwise starting with the nominee and lets a ghost abstain without spending their vote", () => {
    const secret = makeGame(["washerwoman", "librarian", "imp", "baron", "saint"]);
    secret.phase = "day";
    secret.dayStage = "nominations";
    secret.players[4].alive = false;
    const nomination = troubleBrewing.applyCommand(asGame(secret), actor(secret.players[0]), { type: "NOMINATE", nomineeId: secret.players[3].id }, () => 0.4);
    Object.assign(secret, JSON.parse(JSON.stringify(nomination.state.secretState)) as TestSecret);
    expect(secret.currentVoterId).toBe("p3");
    const nomineeView = troubleBrewing.projectPrivateState(secret as unknown as JsonValue, "p3");
    expect(nomineeView?.actions.map(action => action.command)).toContainEqual({ type: "VOTE", vote: true, nomineeId: "p3" });
    expect(nomineeView?.actions.map(action => action.command)).not.toContainEqual({ type: "VOTE", vote: null });
    const earlyVote = troubleBrewing.applyCommand(asGame(secret), actor(secret.players[0]), { type: "VOTE", vote: true }, () => 0.4);
    Object.assign(secret, JSON.parse(JSON.stringify(earlyVote.state.secretState)) as TestSecret);
    expect(secret.currentVoterId).toBe("p3");
    const changedEarlyVote = troubleBrewing.applyCommand(asGame(secret), actor(secret.players[0]), { type: "VOTE", vote: false }, () => 0.4);
    Object.assign(secret, JSON.parse(JSON.stringify(changedEarlyVote.state.secretState)) as TestSecret);

    secret.voteTurnEndsAt = 0;
    const passNominee = troubleBrewing.applyCommand(asGame(secret), actor(secret.players[0]), { type: "ADVANCE_VOTE" }, () => 0.4);
    Object.assign(secret, JSON.parse(JSON.stringify(passNominee.state.secretState)) as TestSecret);
    expect(secret.currentVoterId).toBe("p4");
    secret.voteTurnEndsAt = 0;
    const passGhost = troubleBrewing.applyCommand(asGame(secret), actor(secret.players[0]), { type: "ADVANCE_VOTE" }, () => 0.4);
    Object.assign(secret, JSON.parse(JSON.stringify(passGhost.state.secretState)) as TestSecret);
    expect(secret.players[4].ghostVote).toBe(true);
    expect(secret.currentVoterId).toBe("p0");
    expect(troubleBrewing.projectPublicState(secret as unknown as JsonValue)).toMatchObject({ currentVoter: { playerId: "p0", displayName: "Player 0" } });
    passVoteSweep(secret);
    expect(() => troubleBrewing.applyCommand(asGame(secret), actor(secret.players[0]), { type: "VOTE", vote: true }, () => 0.4)).toThrow(/seat has already been passed/i);
  });

  it("keeps a vote seat open until its two-second timer expires", () => {
    const secret = makeGame(["washerwoman", "librarian", "imp", "baron", "saint"]);
    secret.phase = "day";
    secret.dayStage = "nominations";
    beginVote(secret, secret.players[2].id);
    secret.voteTurnEndsAt = Date.now() + 2000;

    expect(() => troubleBrewing.applyCommand(asGame(secret), actor(secret.players[1]), { type: "ADVANCE_VOTE" }, () => 0.4)).toThrow(/still being counted/i);
    secret.voteTurnEndsAt = Date.now() - 1;
    const passed = troubleBrewing.applyCommand(asGame(secret), actor(secret.players[1]), { type: "ADVANCE_VOTE" }, () => 0.4);
    expect((passed.state.secretState as unknown as TestSecret).currentVoterId).toBe("p3");
  });

  it("keeps nominations open after a vote and executes only the highest vote getter when the host closes", () => {
    const secret = makeGame(["washerwoman", "librarian", "imp", "baron", "saint"]);
    secret.phase = "day";
    secret.dayStage = "nominations";
    const nominateAndVote = (nominator: TestPlayer, nominee: TestPlayer, yesVoters: string[]) => {
      const nomination = troubleBrewing.applyCommand(asGame(secret), actor(nominator), { type: "NOMINATE", nomineeId: nominee.id }, () => 0.4);
      Object.assign(secret, JSON.parse(JSON.stringify(nomination.state.secretState)) as TestSecret);
      raiseSelectedHandsAndPass(secret, yesVoters);
    };

    nominateAndVote(secret.players[0], secret.players[1], ["p0", "p1", "p2"]);
    expect(secret.players[1].alive).toBe(true);
    expect(secret.phase).toBe("day");
    expect(secret.executionBlock).toBe(secret.players[1].id);
    expect(secret.notices.some(notice => notice.includes("voted"))).toBe(false);
    expect(secret.notices).toContain("Player 1 is on the block with 3 votes.");
    expect(troubleBrewing.projectPublicState(secret as unknown as JsonValue)).toMatchObject({ executionBlock: { nomineeName: "Player 1", votes: 3 } });
    const continuingNominationView = troubleBrewing.projectPrivateState(secret as unknown as JsonValue, secret.players[4].id);
    expect(continuingNominationView?.prompt).toMatch(/nominations continue/i);
    expect(continuingNominationView?.actions.some(action => action.command.type === "NOMINATE")).toBe(true);

    nominateAndVote(secret.players[1], secret.players[3], ["p0", "p1", "p2", "p3"]);
    expect(secret.players[3].alive).toBe(true);
    expect(secret.executionBlock).toBe(secret.players[3].id);
    expect(secret.executionBlockVotes).toBe(4);

    const closed = troubleBrewing.applyCommand(asGame(secret), actor(secret.players[0]), { type: "CLOSE_NOMINATIONS" }, () => 0.4);
    const finalState = closed.state.secretState as unknown as TestSecret;
    expect(finalState.players[3].alive).toBe(false);
    expect(finalState.players[1].alive).toBe(true);
    expect(finalState.notices).toContain("Player 3 is executed with 4 votes.");
  });

  it("executes nobody when the leading nomination votes are tied", () => {
    const secret = makeGame(["washerwoman", "librarian", "imp", "baron", "saint"]);
    secret.phase = "day";
    secret.dayStage = "nominations";
    for (const [nominator, nominee] of [[secret.players[0], secret.players[1]], [secret.players[1], secret.players[3]]] as const) {
      const nomination = troubleBrewing.applyCommand(asGame(secret), actor(nominator), { type: "NOMINATE", nomineeId: nominee.id }, () => 0.4);
      Object.assign(secret, JSON.parse(JSON.stringify(nomination.state.secretState)) as TestSecret);
      raiseSelectedHandsAndPass(secret, ["p0", "p1", "p2"]);
    }
    expect(secret.executionBlock).toBeNull();
    expect(secret.executionBlockTied).toBe(true);
    const closed = troubleBrewing.applyCommand(asGame(secret), actor(secret.players[0]), { type: "CLOSE_NOMINATIONS" }, () => 0.4);
    const finalState = closed.state.secretState as unknown as TestSecret;
    expect(finalState.players.every(player => player.alive)).toBe(true);
    expect(finalState.notices).toContain("No execution occurs because the leading vote was tied.");
  });

  it("updates the public vote threshold as players die", () => {
    const secret = makeGame(["imp", "washerwoman", "empath", "fortune-teller", "poisoner", "baron", "saint"]);
    secret.phase = "day";
    secret.dayStage = "nominations";
    const projection = () => troubleBrewing.projectPublicState(secret as unknown as JsonValue) as unknown as { livingPlayerCount: number; votesRequiredForBlock: number };
    expect(projection()).toMatchObject({ livingPlayerCount: 7, votesRequiredForBlock: 4 });
    secret.players[4].alive = false;
    secret.players[5].alive = false;
    expect(projection()).toMatchObject({ livingPlayerCount: 5, votesRequiredForBlock: 3 });
    secret.players[6].alive = false;
    expect(projection()).toMatchObject({ livingPlayerCount: 4, votesRequiredForBlock: 2 });
  });

  it("ends for Good when the Slayer kills the Imp and publishes the role reveal", () => {
    const secret = makeGame(["slayer", "imp", "baron", "saint", "washerwoman"]);
    secret.phase = "day";
    secret.dayStage = "nominations";
    const result = troubleBrewing.applyCommand(asGame(secret), actor(secret.players[0]), { type: "SLAYER_SHOT", targetPlayerId: secret.players[1].id }, () => 0.4);
    expect(result.state.phase).toBe("finished");
    const publicView = troubleBrewing.projectPublicState(result.state.secretState) as unknown as { headline: string; revealedRoles: Array<{ roleName: string }> };
    expect(publicView.headline).toBe("Good wins");
    expect(publicView.revealedRoles).toHaveLength(5);
    expect(publicView.revealedRoles.find(player => player.roleName === "Imp")).toBeTruthy();
  });

  it("actually advances a bot nomination and publishes a notice", () => {
    const secret = makeGame(["washerwoman", "librarian", "imp", "baron", "saint"], ["p1"]);
    secret.phase = "day";
    secret.dayStage = "nominations";
    const result = runNextBotAction(troubleBrewing, asGame(secret), () => 0);
    expect(result?.action.command.type).toBe("NOMINATE");
    const publicView = troubleBrewing.projectPublicState(result!.state.secretState) as unknown as { currentNomination: { nomineeName: string }; notices: string[] };
    expect(publicView.currentNomination.nomineeName).toBeTruthy();
    expect(publicView.notices.some(notice => notice.includes("Player 1 nominated"))).toBe(true);
  });

  it("lets a bot raise its hand on its seat and waits for the sweep to pass it", () => {
    const secret = makeGame(["washerwoman", "librarian", "imp", "baron", "saint"], ["p2"]);
    secret.phase = "day";
    secret.dayStage = "nominations";
    const nomination = troubleBrewing.applyCommand(asGame(secret), actor(secret.players[0]), { type: "NOMINATE", nomineeId: secret.players[2].id }, () => 0.4);
    const game = nomination.state;
    expect((game.secretState as unknown as TestSecret).currentVoterId).toBe("p2");
    expect(hasBotAction(troubleBrewing, game)).toBe(true);
    const botVote = runNextBotAction(troubleBrewing, game, () => 0);
    expect(botVote?.action.command.type).toBe("VOTE");
    expect((botVote?.state.secretState as unknown as TestSecret).currentVoterId).toBe("p2");
    expect((botVote?.state.secretState as unknown as TestSecret).botVotesDecided).toContain("p2");
    (botVote!.state.secretState as unknown as TestSecret).voteTurnEndsAt = 0;
    const advanced = troubleBrewing.applyCommand(botVote!.state, actor(secret.players[0]), { type: "ADVANCE_VOTE" }, () => 0.4);
    expect((advanced.state.secretState as unknown as TestSecret).currentVoterId).toBe("p3");
  });
});

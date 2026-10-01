import { sendState } from "../state.ts";

/**
 * What the control panel needs to follow a game: every move, for the robot's moves how the AI decided, and the
 * clean-up afterwards step by step. The last game and the last clean-up stay until the next ones start.
 */

export type AIDecision = {
    difficulty: string,
    // negamax score per column, null for a full column (positive: the robot can force a win)
    scores: (number | null)[],
    // the scores of tier 1 to 3 (best, second best, third best; repeated if there are fewer)
    tiers: [number, number, number],
    ratios: { tier1: number, tier2: number, tier3: number },
    // the random number that picked the tier, and the tier it picked (1 to 3)
    draw: number,
    tier: 1 | 2 | 3,
    // all columns with the score of that tier; one of them was chosen at random
    candidates: number[],
    durationMs: number,
};

export type Move = {
    number: number,
    by: "player" | "robot",
    column: number,
    // the board before the move, column arrays from the bottom (1 player, 2 robot)
    boardBefore: Record<string, number[]>,
    at: string,
    decision?: AIDecision,
};

export type CleanupStep = {
    column: number,
    row: number,
    color: 1 | 2,
    status: "pending" | "removing" | "returning" | "done" | "failed",
    startedAt?: string,
    durationMs?: number,
};

export type Cleanup = {
    reason: string,
    startedAt: string,
    finishedAt: string | null,
    phase: "init" | "chips" | "reinit" | "done" | "failed",
    steps: CleanupStep[],
    error: string | null,
};

let game: { startedAt: string, moves: Move[], result: string | null } | null = null;
let cleanup: Cleanup | null = null;

export const getAnalysis = () => ({ game, cleanup });

export function recordMove(by: Move["by"], column: number, boardBefore: Record<string, number[]>, decision?: AIDecision) {
    const empty = Object.values(boardBefore).every((c) => c.length === 0);
    // the first move of a game starts a new record, the last game stays visible until then
    if (!game || (empty && by === "player")) game = { startedAt: new Date().toISOString(), moves: [], result: null };
    game.moves.push({ number: game.moves.length + 1, by, column, boardBefore: copy(boardBefore), at: new Date().toISOString(), decision });
    sendState();
}

export function recordResult(result: string) {
    if (!game || game.result) return;
    game.result = result;
    sendState();
}

/** The order the chips are taken back: column by column from the left, the top chip first. */
export function startCleanup(board: Record<string, number[]> | null, reason: string) {
    const steps: CleanupStep[] = [];
    for (let column = 0; column < 7; column++) {
        const chips = board?.[column] ?? [];
        for (let row = chips.length - 1; row >= 0; row--) steps.push({ column, row, color: chips[row] === 2 ? 2 : 1, status: "pending" });
    }
    cleanup = { reason, startedAt: new Date().toISOString(), finishedAt: null, phase: "init", steps, error: null };
    sendState();
}

export function cleanupPhase(phase: Cleanup["phase"]) {
    if (!cleanup) return;
    cleanup.phase = phase;
    if (phase === "done") cleanup.finishedAt = new Date().toISOString();
    sendState();
}

export function cleanupStep(column: number, row: number, status: CleanupStep["status"]) {
    const step = cleanup?.steps.find((s) => s.column === column && s.row === row);
    if (!step) return;
    if (status === "removing") step.startedAt = new Date().toISOString();
    if ((status === "done" || status === "failed") && step.startedAt) step.durationMs = Date.now() - new Date(step.startedAt).getTime();
    step.status = status;
    sendState();
}

export function cleanupFailed(error: unknown) {
    if (!cleanup) return;
    cleanup.phase = "failed";
    cleanup.finishedAt = new Date().toISOString();
    cleanup.error = String((error as any)?.message ?? error);
    cleanup.steps.filter((s) => s.status === "removing" || s.status === "returning").forEach((s) => s.status = "failed");
    sendState();
}

function copy(board: Record<string, number[]>) {
    return Object.fromEntries(Object.entries(board).map(([column, chips]) => [column, [...chips]]));
}

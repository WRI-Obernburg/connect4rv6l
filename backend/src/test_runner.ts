import {boardHasChips, clearPhysicalBoard, GameManager, gameStates} from "./game/game_manager.ts";
import {actionEvents, initChipPalletizing, interruptRV6LAction, moveToBlue, moveToColumn, moveToRed, RV6L_STATE} from "./rv6l_client.ts";
import {resetGame} from "./game/game.ts";
import {sendState, state} from "./state.ts";
import {ErrorType, logEvent} from "./errorHandler/error_handler.ts";

/**
 * Test operation from the control panel: fills the board with chips at random and clears it again with the same
 * robot actions a game uses, once or as an endurance test. The game is in the state TEST meanwhile, so nobody can
 * start a game, and every failed action stops the test like it would stop a game.
 *
 * Chips alternate blue/red starting with blue like in a game, so neither magazine (21 chips each) runs empty.
 */

export type TestMode = "fill" | "clear" | "cycle";

export type TestConfig = {
    mode: TestMode,
    cycles: number,       // only for "cycle"; 0 runs until stopped
    minChips: number,
    maxChips: number,
    pauseSeconds: number, // between two cycles
};

type ActionStats = { count: number, totalMs: number, minMs: number, maxMs: number };
type CycleResult = { cycle: number, chips: number, fillMs: number, clearMs: number, finishedAt: string };

export type TestStatus = {
    running: boolean,
    phase: "idle" | "init" | "fill" | "clear" | "pause",
    config: TestConfig | null,
    cycle: number,
    cyclesDone: number,
    chipsPlaced: number,
    chipsRemoved: number,
    targetChips: number,
    startedAt: string | null,
    finishedAt: string | null,
    stopRequested: boolean,
    result: "done" | "stopped" | "aborted" | "failed" | null,
    error: string | null,
    actions: Record<string, ActionStats>,
    cycles: CycleResult[],
};

const MAX_CHIPS = 42;
const CYCLE_HISTORY = 50;

let status: TestStatus = emptyStatus();
let abortRequested = false;

function emptyStatus(): TestStatus {
    return {
        running: false, phase: "idle", config: null, cycle: 0, cyclesDone: 0, chipsPlaced: 0, chipsRemoved: 0,
        targetChips: 0, startedAt: null, finishedAt: null, stopRequested: false, result: null, error: null,
        actions: {}, cycles: [],
    };
}

export const getTestStatus = () => status;

class TestInterruptedError extends Error {}

/** Starts a test run; returns why it cannot start, or null. */
export function startTest(input: Partial<TestConfig>): string | null {
    if (status.running) return "Es läuft bereits ein Test";
    const config = validate(input);
    if (typeof config === "string") return config;
    if (GameManager.currentGameState.stateName !== "IDLE") {
        return `Test nur im Zustand IDLE möglich, aktuell ${GameManager.currentGameState.stateName}`;
    }
    if (!RV6L_STATE.rv6l_connected && !RV6L_STATE.mock) return "Keine Verbindung zum RV6L";
    if (config.mode === "clear" && !boardHasChips()) return "Auf dem Spielfeld liegen laut Backend keine Chips";
    if (config.mode !== "clear" && boardHasChips()) return "Das Spielfeld ist nicht leer, erst aufräumen";

    status = {...emptyStatus(), running: true, config, startedAt: new Date().toISOString()};
    abortRequested = false;
    GameManager.switchState(gameStates.TEST);
    logEvent({errorType: ErrorType.INFO, description: `Testbetrieb gestartet: ${describe(config)}`, date: new Date().toString()});
    run(config);
    return null;
}

/** Ends the test at the next safe point: no chip in the gripper, and in a cycle the board is cleared first. */
export function requestTestStop() {
    if (!status.running || status.stopRequested) return;
    status.stopRequested = true;
    logEvent({errorType: ErrorType.INFO, description: "Testbetrieb wird beendet, sobald der Roboter an einem sicheren Punkt ist", date: new Date().toString()});
    sendState();
}

/** Stops waiting for the robot at once. The robot finishes its current movement; chips may be left anywhere. */
export function abortTest() {
    if (!status.running) return;
    status.stopRequested = true;
    abortRequested = true;
    interruptRV6LAction();
    sendState();
}

async function run(config: TestConfig) {
    const onAction = (name: string, durationMs: number) => {
        recordAction(name, durationMs);
        if (name === "RemoveFromField") status.chipsRemoved++;
    };
    actionEvents.on("completed", onAction);
    try {
        if (config.mode === "clear") {
            await clear();
        } else {
            // the board is empty, so both magazines are full: start gripping at place 0
            status.phase = "init";
            sendState();
            await initChipPalletizing();
            const cycles = config.mode === "fill" ? 1 : config.cycles;
            for (let cycle = 1; cycles === 0 || cycle <= cycles; cycle++) {
                if (status.stopRequested) break;
                status.cycle = cycle;
                const chips = randomInt(config.minChips, config.maxChips);
                const fillStart = Date.now();
                await fill(chips);
                const fillMs = Date.now() - fillStart;
                if (config.mode === "fill") break;

                const clearStart = Date.now();
                await clear();
                status.cyclesDone++;
                status.cycles = [{cycle, chips: status.targetChips, fillMs, clearMs: Date.now() - clearStart, finishedAt: new Date().toISOString()},
                    ...status.cycles].slice(0, CYCLE_HISTORY);
                sendState();

                if (cycles !== 0 && cycle >= cycles) break;
                await pause(config.pauseSeconds * 1000);
            }
        }
        finish(status.stopRequested ? "stopped" : "done");
    } catch (error) {
        finish(abortRequested ? "aborted" : "failed", error);
    } finally {
        actionEvents.off("completed", onAction);
    }
}

async function fill(chips: number) {
    status.phase = "fill";
    status.targetChips = chips;
    state.board = {0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: []};
    sendState();
    for (let i = 0; i < chips; i++) {
        // only stop between two chips, never with a chip in the gripper
        if (status.stopRequested) break;
        ensureStillInTest();
        const board: Record<string, number[]> = state.board!;
        const free: number[] = Object.keys(board).map(Number).filter((column) => board[column]!.length < 6);
        const column: number = free[randomInt(0, free.length - 1)]!;
        // 1 is the player's blue, 2 the robot's red, like in a game
        const color = i % 2 === 0 ? 1 : 2;
        await (color === 1 ? moveToBlue() : moveToRed());
        ensureStillInTest();
        await moveToColumn(column);
        GameManager.isPhysicalBoardCleaned = false;
        state.board = {...state.board!, [column]: [...state.board![column]!, color]};
        status.chipsPlaced++;
        sendState();
    }
    status.targetChips = Object.values(state.board!).reduce((sum, column) => sum + column.length, 0);
}

async function clear() {
    status.phase = "clear";
    sendState();
    ensureStillInTest();
    // a requested stop waits for the board to be cleared: a half cleared board would leave the pallet counters wrong
    await clearPhysicalBoard();
    resetGame();
}

async function pause(ms: number) {
    status.phase = "pause";
    sendState();
    const until = Date.now() + ms;
    while (Date.now() < until && !status.stopRequested) {
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
}

// a critical fault switches the game to ERROR, which also ends the test
function ensureStillInTest() {
    if (abortRequested) throw new TestInterruptedError("Test abgebrochen");
    const current = GameManager.currentGameState.stateName;
    if (current !== "TEST") throw new TestInterruptedError(`Spiel ist im Zustand ${current}, Test beendet`);
}

function finish(result: NonNullable<TestStatus["result"]>, error?: unknown) {
    status.running = false;
    status.phase = "idle";
    status.result = result;
    status.error = error == null ? null : String((error as any)?.message ?? error);
    status.finishedAt = new Date().toISOString();
    const summary = `${status.cyclesDone} Zyklen, ${status.chipsPlaced} Chips eingeworfen, ${status.chipsRemoved} entnommen`;
    logEvent({
        errorType: result === "failed" ? ErrorType.FATAL : result === "aborted" ? ErrorType.WARNING : ErrorType.INFO,
        description: {
            done: `Testbetrieb beendet: ${summary}`,
            stopped: `Testbetrieb gestoppt: ${summary}`,
            aborted: `Testbetrieb abgebrochen, Chips können noch im Greifer oder auf dem Feld liegen: ${summary}`,
            failed: `Testbetrieb fehlgeschlagen: ${status.error} (${summary})`,
        }[result],
        date: new Date().toString()
    });
    // a fault has already switched to ERROR; leaving that is up to the fault memory
    if (GameManager.currentGameState.stateName === "TEST") GameManager.switchState(gameStates.IDLE);
    sendState();
}

function recordAction(actionName: string, durationMs: number) {
    // MoveToColumn3 and MoveToColumn5 are the same kind of movement
    const name = actionName.replace(/\d+$/, "");
    const stats = status.actions[name] ?? {count: 0, totalMs: 0, minMs: Infinity, maxMs: 0};
    status.actions[name] = {
        count: stats.count + 1,
        totalMs: stats.totalMs + durationMs,
        minMs: Math.min(stats.minMs, durationMs),
        maxMs: Math.max(stats.maxMs, durationMs),
    };
}

function validate(input: Partial<TestConfig>): TestConfig | string {
    const mode = input.mode;
    if (mode !== "fill" && mode !== "clear" && mode !== "cycle") return "Unbekannte Testart";
    const cycles = Number(input.cycles ?? 1);
    const minChips = Number(input.minChips ?? 1);
    const maxChips = Number(input.maxChips ?? minChips);
    const pauseSeconds = Number(input.pauseSeconds ?? 0);
    if (!Number.isInteger(cycles) || cycles < 0 || cycles > 100000) return "Zyklen müssen eine ganze Zahl ab 0 sein (0 = endlos)";
    if (!Number.isInteger(minChips) || !Number.isInteger(maxChips) || minChips < 1 || maxChips > MAX_CHIPS || minChips > maxChips) {
        return `Chipanzahl muss zwischen 1 und ${MAX_CHIPS} liegen, Minimum höchstens Maximum`;
    }
    if (!Number.isFinite(pauseSeconds) || pauseSeconds < 0 || pauseSeconds > 3600) return "Pause muss zwischen 0 und 3600 s liegen";
    return {mode, cycles, minChips, maxChips, pauseSeconds};
}

function describe(config: TestConfig) {
    const chips = config.minChips === config.maxChips ? `${config.minChips}` : `${config.minChips}–${config.maxChips}`;
    if (config.mode === "clear") return "Spielfeld aufräumen";
    if (config.mode === "fill") return `Spielfeld mit ${chips} Chips bestücken`;
    return `${config.cycles === 0 ? "Dauertest" : `${config.cycles} Zyklen`} mit je ${chips} Chips, ${config.pauseSeconds} s Pause`;
}

function randomInt(min: number, max: number) {
    return min + Math.floor(Math.random() * (max - min + 1));
}

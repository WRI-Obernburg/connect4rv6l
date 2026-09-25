import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import { ErrorType, logEvent } from "./errorHandler/error_handler.ts";
import { sendState, state } from "./state.ts";

/**
 * Fault memory like in a car: a fault stays stored after its cause is gone and has to be
 * acknowledged in the control panel. It can only be acknowledged once it is no longer active.
 * Unacknowledged critical faults block the start of new games (see isGameStartBlocked).
 *
 * Two kinds of entries:
 * - conditions (updateCondition): active as long as something is wrong, e.g. a collision flag
 * - events (recordEvent): happened once, e.g. a robot action that failed
 */

export type FaultSeverity = "fatal" | "warning";

export type FaultEntry = {
    key: string,
    title: string,
    severity: FaultSeverity,
    // critical faults block new games until they are acknowledged
    critical: boolean,
    source: string,
    details?: string,
    active: boolean,
    firstSeen: string,
    lastSeen: string,
    occurrences: number,
    acknowledgedAt?: string,
};

export type FaultInfo = Pick<FaultEntry, "title" | "severity" | "critical" | "source" | "details">;

const FILE = process.env.FAULT_MEMORY_FILE || "logs/fault_memory.json";
const HISTORY_LIMIT = 100;

let open: FaultEntry[] = [];
let acknowledged: FaultEntry[] = [];

export function initFaultMemory() {
    try {
        const saved = JSON.parse(readFileSync(FILE, "utf8"));
        // whether a condition is still present is found out again by the next check
        open = (saved.open ?? []).map((entry: FaultEntry) => ({ ...entry, active: false }));
        acknowledged = saved.acknowledged ?? [];
    } catch {
        open = [];
        acknowledged = [];
    }
    state.gameStartBlocked = isGameStartBlocked();
}

export function getFaultMemory() {
    return { open, acknowledged, gameStartBlocked: isGameStartBlocked() };
}

export function isGameStartBlocked() {
    return open.some((entry) => entry.critical);
}

// The telemetry adds the live readiness of the robot (drives, mode, program) to the start lock
let robotReady: () => boolean = () => true;

export function setRobotReadyCheck(check: () => boolean) {
    robotReady = check;
}

export function updateStartLock() {
    const blocked = isGameStartBlocked() || !robotReady();
    if (state.gameStartBlocked !== blocked) {
        state.gameStartBlocked = blocked;
        sendState();
    }
}

/** Reports whether a condition is present right now; stores it the first time it becomes active. */
export function updateCondition(key: string, active: boolean, info: FaultInfo) {
    const entry = open.find((e) => e.key === key);
    if (!active) {
        if (entry?.active) {
            entry.active = false;
            changed();
        }
        return;
    }
    if (entry?.active) {
        // keep details like counter values up to date without counting a new occurrence
        if (entry.title !== info.title || entry.details !== info.details) {
            Object.assign(entry, info);
            changed();
        }
        return;
    }
    store(key, info, true);
}

/** Stores something that happened once, e.g. a failed robot action. */
export function recordEvent(key: string, info: FaultInfo) {
    store(key, info, false);
}

function store(key: string, info: FaultInfo, active: boolean) {
    const now = new Date().toISOString();
    const entry = open.find((e) => e.key === key);
    if (entry) {
        Object.assign(entry, info, { active, lastSeen: now, occurrences: entry.occurrences + 1 });
    } else {
        open.push({ key, ...info, active, firstSeen: now, lastSeen: now, occurrences: 1 });
    }
    if (info.critical) {
        logEvent({
            errorType: ErrorType.WARNING,
            description: `Fehlerspeicher: ${info.title}. Neue Spiele sind gesperrt, bis der Fehler quittiert ist.`,
            date: now
        });
    }
    changed();
}

/** Acknowledges one fault; a fault that is still active cannot be acknowledged. */
export function acknowledgeFault(key: string): { ok: boolean, reason?: string } {
    const entry = open.find((e) => e.key === key);
    if (!entry) return { ok: false, reason: "Eintrag nicht gefunden" };
    if (entry.active) return { ok: false, reason: "Der Fehler liegt noch an und kann erst nach Behebung quittiert werden" };
    open = open.filter((e) => e !== entry);
    acknowledged = [{ ...entry, acknowledgedAt: new Date().toISOString() }, ...acknowledged].slice(0, HISTORY_LIMIT);
    logEvent({
        errorType: ErrorType.INFO,
        description: `Fehlerspeicher: "${entry.title}" quittiert`,
        date: new Date().toString()
    });
    changed();
    return { ok: true };
}

/** Acknowledges every fault that is no longer active. */
export function acknowledgeAllInactive() {
    open.filter((e) => !e.active).forEach((e) => acknowledgeFault(e.key));
}

function changed() {
    try {
        mkdirSync(dirname(FILE), { recursive: true });
        writeFileSync(FILE, JSON.stringify({ open, acknowledged }, null, 1));
    } catch (error) {
        console.error("Could not save the fault memory", error);
    }
    sendState();
    updateStartLock();
}

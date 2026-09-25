import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import { ErrorType, logEvent } from "./errorHandler/error_handler.ts";
import { sendState } from "./state.ts";
import { RV6L_STATE } from "./rv6l_client.ts";

/**
 * Fault memory like in a car: a fault stays stored after its cause is gone and has to be
 * acknowledged in the control panel. It can only be acknowledged once it is no longer active.
 * While a critical fault is open, the game is locked in the ERROR state; it leaves
 * ERROR on its own once nothing is open any more (see getLockReasons and GameManager.applyLock).
 * Faults can also be created by hand, e.g. "Spielfeld wird repariert", and are acknowledged like any other.
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
}

export function getFaultMemory() {
    return {
        open: open.map((entry) => ({ ...entry, hardware: isHardwareFault(entry) })),
        acknowledged,
        lockReasons: getLockReasons(),
        mock: RV6L_STATE.mock,
    };
}

// Faults that come from the robot or its controller: the telemetry, messages of the controller, the connection
// and robot actions. With the RV6L connection mocked they do not lock the game, so it can be played without robot.
function isHardwareFault(entry: FaultEntry) {
    return ["telemetry:", "message:", "rv6l:"].some((prefix) => entry.key.startsWith(prefix));
}

/**
 * Why the game is locked in ERROR: every open critical fault, including a robot that is not ready (drives,
 * operating mode, program, connection), which the telemetry reports as critical faults. Empty means free.
 */
export function getLockReasons(): string[] {
    return open.filter((entry) => entry.critical && !(RV6L_STATE.mock && isHardwareFault(entry))).map((entry) => entry.title);
}

// The game manager switches into and out of ERROR; registered here to avoid an import cycle
let lockListener: ((reasons: string[]) => void) | null = null;

export function onLockChange(listener: (reasons: string[]) => void) {
    lockListener = listener;
}

export function updateLock() {
    lockListener?.(getLockReasons());
}

/** A fault created by hand in the control panel, e.g. while the board is repaired; it is acknowledged like any other. */
export function createManualFault(title: string, details: string | undefined, critical: boolean) {
    recordEvent(`manual:${Date.now()}`, {
        title, details: details || undefined, severity: critical ? "fatal" : "warning", critical, source: "Manuell angelegt",
    });
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
            description: `Fehlerspeicher: ${info.title}. Das Spiel ist gesperrt, bis der Fehler quittiert ist.`,
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
    updateLock();
}

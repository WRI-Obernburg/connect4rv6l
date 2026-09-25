import { getSymbolList, readSymbol, readSymbols, RV6L_STATE, type SymbolListType } from "./rv6l_client.ts";
import { ErrorType, logEvent } from "./errorHandler/error_handler.ts";
import { sendStateToControlPanelClient } from "./internal_server.ts";

/**
 * Reads the state of the RV6L controller once per second for the control panel and reports
 * alarms (collision, collective fault, compressed air) as events.
 *
 * PLC flags M<byte>.<bit> are read from _IPLC[n], which holds the flags M(4(n-1)) to M(4(n-1)+3),
 * lowest byte first. This mapping is derived from the Reis documentation and still has to be
 * confirmed on the robot (tools/rv6l-test.mjs).
 */

type Severity = "fatal" | "warning";

type TelemetryItem = {
    id: string,
    group: string,
    label: string,
    symbol: string,
    bit?: number,
    kind: "number" | "flag" | "position" | "bits",
    unit?: string,
    // value of a flag that means something is wrong
    alarmWhen?: 0 | 1,
    severity?: Severity,
    note?: string,
};

export type TelemetryValue = {
    id: string,
    group: string,
    label: string,
    symbol: string,
    kind: TelemetryItem["kind"],
    unit?: string,
    note?: string,
    available: boolean,
    value: number | string | null,
    alarm: boolean,
    severity?: Severity,
    position?: { x: number, y: number, z: number, axes: number[] },
};

const flag = (byte: number, bit: number) => ({ symbol: `_IPLC[${Math.floor(byte / 4) + 1}]`, bit: (byte % 4) * 8 + bit });

const ITEMS: TelemetryItem[] = [
    { id: "program_running", group: "Programm", label: "Roboterprogramm läuft (M935.6)", ...flag(935, 6), kind: "flag", alarmWhen: 0, severity: "warning" },
    { id: "start_request", group: "Programm", label: "Start-Anforderung (M968.1)", ...flag(968, 1), kind: "flag" },
    { id: "stop_request", group: "Programm", label: "Stopp-Anforderung (M968.2)", ...flag(968, 2), kind: "flag" },
    { id: "action", group: "Programm", label: "Aktion (I_Aktion)", symbol: "I_Aktion", kind: "number", note: "0 = bereit" },
    { id: "column", group: "Programm", label: "Spalte (IX_Schacht)", symbol: "IX_Schacht", kind: "number" },
    { id: "field_x", group: "Programm", label: "Feld X (IX_Feld)", symbol: "IX_Feld", kind: "number" },
    { id: "field_z", group: "Programm", label: "Feld Z (IZ_Feld)", symbol: "IZ_Feld", kind: "number" },

    { id: "collective_fault", group: "Störungen", label: "Sammelstörung (M1012.2)", ...flag(1012, 2), kind: "flag", alarmWhen: 1, severity: "fatal" },
    { id: "compressed_air", group: "Störungen", label: "Druckluft", symbol: "", kind: "flag", alarmWhen: 0, severity: "fatal", note: "Eingang aus Maschinendatum IBIN_FUNC_IN[1]" },
    { id: "collision", group: "Störungen", label: "Kollision erkannt (M970.3)", ...flag(970, 3), kind: "flag", alarmWhen: 1, severity: "fatal" },
    { id: "collision_detection", group: "Störungen", label: "Kollisionserkennung aktiv (M970.2)", ...flag(970, 2), kind: "flag", alarmWhen: 0, severity: "warning" },
    ...[1, 2, 3, 4, 5, 6].map((axis): TelemetryItem => ({
        id: `collision_axis_${axis}`, group: "Störungen", label: `Kollision Achse ${axis} (M1592.${axis - 1})`,
        ...flag(1592, axis - 1), kind: "flag", alarmWhen: 1, severity: "fatal",
    })),

    { id: "position", group: "Bewegung", label: "Istposition (_PACTPOS)", symbol: "_PACTPOS", kind: "position" },
    ...[1, 2, 3, 4, 5, 6].map((axis): TelemetryItem => ({
        id: `speed_axis_${axis}`, group: "Bewegung", label: `Geschwindigkeit Achse ${axis}`, symbol: `_RACTUAL_SPEED[${axis}]`, kind: "number",
    })),
    ...[1, 2, 3, 4, 5, 6].map((axis): TelemetryItem => ({
        id: `current_axis_${axis}`, group: "Bewegung", label: `Motorstrom Achse ${axis}`, symbol: `_RCURR_ACT[${axis}]`, kind: "number",
    })),

    { id: "gripper", group: "Ein-/Ausgänge", label: "Greifer (_IBIN_OUT[6])", symbol: "_IBIN_OUT[6]", kind: "number" },
    { id: "inputs_1", group: "Ein-/Ausgänge", label: "Eingänge (_IBIN_IN[1])", symbol: "_IBIN_IN[1]", kind: "bits" },
    { id: "inputs_2", group: "Ein-/Ausgänge", label: "Eingänge (_IBIN_IN[2])", symbol: "_IBIN_IN[2]", kind: "bits" },
    { id: "outputs_1", group: "Ein-/Ausgänge", label: "Ausgänge (_IBIN_OUT[1])", symbol: "_IBIN_OUT[1]", kind: "bits" },

    { id: "interpreter", group: "SPS-Rohwerte", label: "Interpretermodus (_INTERPRETER)", symbol: "_INTERPRETER", kind: "bits" },
    ...[234, 243, 254, 399].map((index): TelemetryItem => ({
        id: `iplc_${index}`, group: "SPS-Rohwerte", label: `_IPLC[${index}]`, symbol: `_IPLC[${index}]`, kind: "bits",
    })),
];

const POLL_INTERVAL_MS = 1000;
const RETRY_UNAVAILABLE_MS = 60000;

let values: TelemetryValue[] = [];
let updatedAt: string | null = null;
let unavailable = new Set<string>();
let lastAvailabilityCheck = 0;
let wasConnected = false;
let pollRunning = false;
let lastPollError = "";
const alarmActive = new Map<string, boolean>();

export function getTelemetry() {
    return { updatedAt, values };
}

export function initTelemetry() {
    setInterval(() => {
        if (pollRunning) return;
        pollRunning = true;
        poll().then(() => lastPollError = "").catch((error) => {
            // report a lasting problem once instead of every second
            if (String(error) === lastPollError) return;
            lastPollError = String(error);
            logEvent({
                errorType: ErrorType.WARNING,
                description: `RV6L telemetry could not be read: ${error}`,
                date: new Date().toString()
            });
        }).finally(() => pollRunning = false);
    }, POLL_INTERVAL_MS);
}

async function poll() {
    if (RV6L_STATE.mock || !RV6L_STATE.rv6l_connected) {
        if (wasConnected) {
            wasConnected = false;
            values = values.map((value) => ({ ...value, available: false, value: null, alarm: false }));
            alarmActive.clear();
            sendStateToControlPanelClient?.();
        }
        return;
    }

    if (!wasConnected) {
        // new connection: the controller may have changed, check everything again
        wasConnected = true;
        unavailable = new Set();
        await resolveCompressedAirInput();
        lastAvailabilityCheck = 0;
    }

    const symbols = [...new Set(ITEMS.map((item) => item.symbol).filter((symbol) => symbol && !unavailable.has(symbol)))];
    let raw: Record<string, string>;
    try {
        raw = symbols.length ? await readSymbols(symbols) : {};
    } catch (error) {
        // one unknown symbol fails the whole request, so find out which ones the controller knows
        await checkAvailability(symbols);
        return;
    }
    if (unavailable.size && Date.now() - lastAvailabilityCheck > RETRY_UNAVAILABLE_MS) {
        await checkAvailability([...unavailable]);
    }

    values = ITEMS.map((item) => toValue(item, item.symbol in raw ? raw[item.symbol] : undefined));
    updatedAt = new Date().toISOString();
    reportAlarms();
    sendStateToControlPanelClient?.();
}

async function checkAvailability(symbols: string[]) {
    lastAvailabilityCheck = Date.now();
    for (const symbol of symbols) {
        try {
            await readSymbol(symbol);
            unavailable.delete(symbol);
        } catch (error) {
            if (String(error).includes("RV6L error")) unavailable.add(symbol);
            else throw error; // connection problem, not an unknown symbol
        }
    }
}

// The input of the compressed air switch is configured in the machine data IBIN_FUNC_IN[1]
async function resolveCompressedAirInput() {
    const item = ITEMS.find((i) => i.id === "compressed_air")!;
    try {
        const input = parseInt(await readSymbol("IBIN_FUNC_IN[1]", true));
        if (input > 0) {
            // assumption: inputs are numbered from 1 in 32 bit fields of _IBIN_IN, to be confirmed on the robot
            item.symbol = `_IBIN_IN[${Math.floor((input - 1) / 32) + 1}]`;
            item.bit = (input - 1) % 32;
            item.label = `Druckluft (Eingang ${input})`;
            item.note = `Eingang ${input} aus Maschinendatum IBIN_FUNC_IN[1], Zuordnung zu ${item.symbol} Bit ${item.bit} noch ungeprüft`;
        } else {
            item.symbol = "";
            item.note = "Kein Druckluft-Eingang in IBIN_FUNC_IN[1] konfiguriert";
        }
    } catch (error) {
        item.symbol = "";
        item.note = `IBIN_FUNC_IN[1] nicht lesbar: ${error}`;
    }
}

function toValue(item: TelemetryItem, raw: string | undefined): TelemetryValue {
    const base: TelemetryValue = {
        id: item.id, group: item.group, label: item.label, symbol: item.symbol, kind: item.kind,
        unit: item.unit, note: item.note, severity: item.severity,
        available: raw !== undefined, value: null, alarm: false,
    };
    if (raw === undefined) return base;

    if (item.kind === "flag") {
        const bit = item.bit === undefined ? Number(raw) & 1 : (Number(raw) >>> item.bit) & 1;
        return { ...base, value: bit, alarm: item.alarmWhen !== undefined && bit === item.alarmWhen };
    }
    if (item.kind === "position") {
        // structure: main axes, additional axes, type, frame, X, Y, Z, TZ(3), TX(3), axis values ...
        const tokens = raw.split(/\s+/);
        const mainAxes = parseInt(tokens[0] ?? "") || 6;
        return {
            ...base, value: raw,
            position: {
                x: Number(tokens[4]), y: Number(tokens[5]), z: Number(tokens[6]),
                axes: tokens.slice(13, 13 + mainAxes).map(Number),
            },
        };
    }
    if (item.kind === "bits") {
        return { ...base, value: Number(raw) >>> 0 };
    }
    const number = Number(raw);
    return { ...base, value: Number.isNaN(number) ? raw : number };
}

function reportAlarms() {
    for (const value of values) {
        if (!value.available || !value.severity) continue;
        const before = alarmActive.get(value.id) ?? false;
        if (value.alarm === before) continue;
        alarmActive.set(value.id, value.alarm);
        logEvent({
            // fatal alarms also switch the game into the ERROR state
            errorType: value.alarm ? (value.severity === "fatal" ? ErrorType.FATAL : ErrorType.WARNING) : ErrorType.INFO,
            description: value.alarm ? `RV6L: ${value.label} meldet Störung` : `RV6L: ${value.label} wieder in Ordnung`,
            date: new Date().toString()
        });
    }
}

// Read only helpers for the variable explorer in the control panel
const SYMBOL_LIST_TYPES: SymbolListType[] = ["sysVar", "var", "input", "output", "marker", "machineData"];

export async function listSymbolsForExplorer(type: string) {
    if (!SYMBOL_LIST_TYPES.includes(type as SymbolListType)) throw new Error(`Unknown symbol list type ${type}`);
    return getSymbolList(type as SymbolListType);
}

export async function readSymbolsForExplorer(names: unknown) {
    if (!Array.isArray(names) || names.length === 0 || names.length > 50 || !names.every((n) => typeof n === "string" && n.length <= 100)) {
        throw new Error("Expected 1 to 50 symbol names");
    }
    const result: Record<string, { value?: string, error?: string }> = {};
    for (const name of names as string[]) {
        try {
            result[name] = { value: await readSymbol(name) };
        } catch (error) {
            result[name] = { error: String(error) };
        }
    }
    return result;
}

import { getSymbolList, readSymbol, readSymbols, RV6L_STATE, type SymbolListType } from "./rv6l_client.ts";
import { ErrorType, logEvent } from "./errorHandler/error_handler.ts";
import { sendStateToControlPanelClient } from "./internal_server.ts";
import { lookupRsvError, type RsvError } from "./rsv_errors.ts";

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
    kind: "number" | "flag" | "position" | "bits" | "text",
    unit?: string,
    // value of a flag that means something is wrong
    alarmWhen?: 0 | 1,
    // for numbers: alarm when the value is one of these
    alarmValues?: number[],
    // for numbers: alarm when the value is not 0
    alarmWhenNotZero?: boolean,
    // for numbers: alarm when the value is at or below this limit
    alarmAtOrBelow?: number,
    severity?: Severity,
    // describes the problem, e.g. "Roboterprogramm läuft nicht" instead of the item's label
    alarmText?: string,
    // shown instead of the raw value while everything is fine, e.g. "läuft"
    okText?: string,
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
    alarmText?: string,
    okText?: string,
    severity?: Severity,
    position?: { x: number, y: number, z: number, axes: number[] },
};

const flag = (byte: number, bit: number) => ({ symbol: `_IPLC[${Math.floor(byte / 4) + 1}]`, bit: (byte % 4) * 8 + bit });

const ITEMS: TelemetryItem[] = [
    { id: "drives", group: "Steuerung", label: "Antriebe", symbol: "_SSTATUS_TEXT[1]", kind: "text", note: "RP_STATUS_DRIVE_ON = Antriebe ein" },
    { id: "user_level", group: "Steuerung", label: "Benutzerlevel", symbol: "_SSTATUS_TEXT[2]", kind: "text" },
    { id: "selected_program", group: "Steuerung", label: "Angewähltes Programm", symbol: "_SPROGRAM[1]", kind: "text", note: "Für das Spiel muss 4GEWINNT laufen" },
    { id: "override_auto", group: "Steuerung", label: "Override Automatik", symbol: "_IAUTO_OVER", kind: "number", unit: "%" },
    { id: "override_manual", group: "Steuerung", label: "Override Hand", symbol: "_IMAN_OVER", kind: "number", unit: "%" },
    { id: "brakes", group: "Steuerung", label: "Status Bremsen", symbol: "_ISTATUS_OF_BRAKES", kind: "bits" },
    { id: "safety_controller", group: "Steuerung", label: "Safety-Controller Status", symbol: "_ISC_STATUS_INTERN", kind: "bits" },
    { id: "ups", group: "Steuerung", label: "USV-Status", symbol: "_IUPS_STATUS", kind: "bits" },

    { id: "program_running", group: "Programm", label: "Roboterprogramm", ...flag(935, 6), kind: "flag", alarmWhen: 0, severity: "warning", okText: "läuft", alarmText: "Roboterprogramm läuft nicht", note: "Merker M935.6" },
    { id: "start_request", group: "Programm", label: "Start-Anforderung (M968.1)", ...flag(968, 1), kind: "flag" },
    { id: "stop_request", group: "Programm", label: "Stopp-Anforderung (M968.2)", ...flag(968, 2), kind: "flag" },
    // total part counters of the pallets (PALETTE_BLAU/ROT.MPR): 21 after #INIT, every PALETTE #EIN counts
    // down by one, for gripping as well as for putting a chip back. At 0 the pallet silently starts over.
    { id: "pallet_blue", group: "Programm", label: "Palette blau, Zähler der Steuerung (I_blau)", symbol: "I_blau", kind: "number", alarmAtOrBelow: 0, severity: "warning", alarmText: "Palette blau leer, Zähler I_blau ist {value}" },
    { id: "pallet_red", group: "Programm", label: "Palette rot, Zähler der Steuerung (I_rot)", symbol: "I_rot", kind: "number", alarmAtOrBelow: 0, severity: "warning", alarmText: "Palette rot leer, Zähler I_rot ist {value}" },
    { id: "action", group: "Programm", label: "Aktion (I_Aktion)", symbol: "I_Aktion", kind: "number", note: "0 = bereit" },
    { id: "column", group: "Programm", label: "Spalte (IX_Schacht)", symbol: "IX_Schacht", kind: "number" },
    { id: "field_x", group: "Programm", label: "Feld X (IX_Feld)", symbol: "IX_Feld", kind: "number" },
    { id: "field_z", group: "Programm", label: "Feld Z (IZ_Feld)", symbol: "IZ_Feld", kind: "number" },

    { id: "collective_fault", group: "Störungen", label: "Sammelstörung", ...flag(1012, 2), kind: "flag", alarmWhen: 1, severity: "fatal", okText: "keine", alarmText: "Sammelstörung aktiv", note: "Merker M1012.2" },
    // the input of the pressure switch is set in the machine data IBIN_FUNC_IN[1], which cannot be read
    // via the interface, so missing air is detected by the controller's message S19
    { id: "compressed_air", group: "Störungen", label: "Druckluft", symbol: "_IACT_ERROR", kind: "number", alarmValues: [19], severity: "fatal", okText: "in Ordnung", alarmText: "Druckluft fehlt (Meldung S19)", note: "Erkannt über Meldung S19 der Steuerung" },
    { id: "safety_controller_error", group: "Störungen", label: "Safety-Controller", symbol: "_ISC_ERROR[1]", kind: "number", alarmWhenNotZero: true, severity: "fatal", okText: "kein Fehler", alarmText: "Safety-Controller meldet Fehler {value}" },
    { id: "collision", group: "Störungen", label: "Kollision", ...flag(970, 3), kind: "flag", alarmWhen: 1, severity: "fatal", okText: "keine", alarmText: "Kollision erkannt", note: "Merker M970.3" },
    ...[1, 2, 3, 4, 5, 6].map((axis): TelemetryItem => ({
        id: `collision_axis_${axis}`, group: "Störungen", label: `Kollision Achse ${axis}`,
        ...flag(1592, axis - 1), kind: "flag", alarmWhen: 1, severity: "fatal", okText: "keine", alarmText: `Kollision an Achse ${axis}`,
        note: `Merker M1592.${axis - 1}`,
    })),
    { id: "collision_detection", group: "Störungen", label: "Kollisionserkennung", ...flag(970, 2), kind: "flag", alarmWhen: 0, severity: "warning", okText: "eingeschaltet", alarmText: "Kollisionserkennung ist ausgeschaltet", note: "Merker M970.2" },

    // messages of the controller, shown with the explanation from the Reis error reference
    { id: "active_message", group: "Meldung", label: "Aktiver Fehler", symbol: "_IACT_ERROR", kind: "number", alarmWhenNotZero: true, severity: "warning", alarmText: "Steuerung meldet S{value}" },
    { id: "displayed_message", group: "Meldung", label: "Am Bedienpanel angezeigte Meldung", symbol: "_IDISP_ERROR", kind: "number" },
    { id: "displayed_message_text", group: "Meldung", label: "Text am Bedienpanel", symbol: "_SDISP_ERROR", kind: "text" },

    { id: "position", group: "Bewegung", label: "Istposition (_PACTPOS)", symbol: "_PACTPOS", kind: "position" },
    ...[1, 2, 3, 4, 5, 6].map((axis): TelemetryItem => ({
        id: `speed_axis_${axis}`, group: "Bewegung", label: `Geschwindigkeit Achse ${axis}`, symbol: `_RACTUAL_SPEED[${axis}]`, kind: "number",
    })),
    ...[1, 2, 3, 4, 5, 6].map((axis): TelemetryItem => ({
        id: `current_axis_${axis}`, group: "Bewegung", label: `Motorstrom Achse ${axis}`, symbol: `_RCURR_ACT[${axis}]`, kind: "number",
    })),

    // the robot program switches the vacuum with SCHR_BIT #AUSGANG Byte 20 Bit 0, which is bit 0 of _IBIN_OUT[6]
    { id: "vacuum", group: "Ein-/Ausgänge", label: "Vakuum Sauger (Ausgang Byte 20 Bit 0)", symbol: "_IBIN_OUT[6]", bit: 0, kind: "flag" },
    { id: "outputs_6", group: "Ein-/Ausgänge", label: "Ausgänge (_IBIN_OUT[6], Byte 20 bis 23)", symbol: "_IBIN_OUT[6]", kind: "bits" },
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

export type ControllerMessage = {
    number: number,
    source: "active" | "displayed",
    level: string | null,
    reference: RsvError | null,
};

export function getTelemetry() {
    return { updatedAt, values, messages: getMessages() };
}

// The controller keeps the active error (_IACT_ERROR) and the message shown on the pendant (_IDISP_ERROR)
// separately, e.g. S84 active while "Error #21" is displayed, so both are explained
function getMessages(): ControllerMessage[] {
    const numberOf = (id: string) => Number(values.find((v) => v.id === id && v.available)?.value ?? 0);
    const displayedText = String(values.find((v) => v.id === "displayed_message_text")?.value ?? "");
    const messages: ControllerMessage[] = [];
    const displayed = numberOf("displayed_message");
    if (displayed) {
        const level = /^(\w+)\s*#/.exec(displayedText)?.[1] ?? null;
        messages.push({ number: displayed, source: "displayed", level, reference: lookupRsvError(displayed) });
    }
    const active = numberOf("active_message");
    if (active && active !== displayed) {
        messages.push({ number: active, source: "active", level: null, reference: lookupRsvError(active) });
    }
    return messages;
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

    values = ITEMS.map((item) => toValue(item, item.symbol in raw ? raw[item.symbol] : undefined))
        .map((value) => withBackendChipCount(value))
        .map((value) => withMessageText(value));
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

// The backend keeps its own chip count; a difference to the controller's counter means the pallet
// no longer matches the real magazine, which is shown as a warning
function withBackendChipCount(value: TelemetryValue): TelemetryValue {
    const pallets: Record<string, { color: string, backendCount: number }> = {
        pallet_blue: { color: "blau", backendCount: RV6L_STATE.blueChipsLeft },
        pallet_red: { color: "rot", backendCount: RV6L_STATE.redChipsLeft },
    };
    const pallet = pallets[value.id];
    if (!pallet) return value;
    const noted = { ...value, note: `Backend zählt ${pallet.backendCount} Chips` };
    if (!value.available || value.alarm || Number(value.value) === pallet.backendCount) return noted;
    return {
        ...noted, alarm: true,
        alarmText: `Palette ${pallet.color}: Steuerung zählt ${value.value} Chips, Backend ${pallet.backendCount}`,
    };
}

// "Steuerung meldet S84" is not helpful on its own, add the text from the error reference
function withMessageText(value: TelemetryValue): TelemetryValue {
    if (value.id !== "active_message" || !value.alarm) return value;
    const reference = lookupRsvError(Number(value.value));
    return reference ? { ...value, alarmText: `${value.alarmText}: ${reference.message}` } : value;
}

function toValue(item: TelemetryItem, raw: string | undefined): TelemetryValue {
    const value = { ...toRawValue(item, raw), okText: item.okText };
    return value.alarm ? { ...value, alarmText: (item.alarmText ?? item.label).replace("{value}", String(value.value)) } : value;
}

function toRawValue(item: TelemetryItem, raw: string | undefined): TelemetryValue {
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
    if (item.kind === "text") {
        return { ...base, value: raw.replace(/^<!\[CDATA\[|\]\]>$/g, "").trim() };
    }
    if (item.kind === "bits") {
        return { ...base, value: Number(raw) >>> 0 };
    }
    const number = Number(raw);
    if (Number.isNaN(number)) return { ...base, value: raw };
    const alarm = (item.alarmValues?.includes(number) ?? false)
        || (item.alarmWhenNotZero === true && number !== 0)
        || (item.alarmAtOrBelow !== undefined && number <= item.alarmAtOrBelow);
    return { ...base, value: number, alarm };
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
            description: value.alarm ? `RV6L: ${value.alarmText}` : `RV6L: ${value.label} wieder in Ordnung`,
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

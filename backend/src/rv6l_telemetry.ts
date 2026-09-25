import { getSymbolList, readControllerState, readSymbol, readSymbols, RV6L_STATE, type ControllerState, type SymbolListType } from "./rv6l_client.ts";
import { ErrorType, logEvent } from "./errorHandler/error_handler.ts";
import { sendStateToControlPanelClient } from "./internal_server.ts";
import { lookupRsvError, type RsvError } from "./rsv_errors.ts";
import { recordEvent, setRobotReadyCheck, updateCondition, updateStartLock } from "./fault_memory.ts";
import { state } from "./state.ts";
import { GameManager } from "./game/game_manager.ts";

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
    // overrides the static list of critical items, e.g. robot readiness is only critical during a game
    critical?: boolean,
    position?: { x: number, y: number, z: number, axes: number[] },
};

const POLL_INTERVAL_MS = 1000;
const MIN_AUTO_OVERRIDE = 10;
// warn when a motor draws more than this share of its maximum current
const CURRENT_WARNING_SHARE = 0.9;
// the game only works with this program running in the interpreter
const GAME_PROGRAM = (process.env.ROBOT_PROGRAM || "S:/PROG/4GEWINNT/AKTUELL/4GEWINNT.MPR").toUpperCase();
// game states in which the robot moves; a much longer duration than expected means it is stuck
const MOVING_STATES = ["GRAP_BLUE_CHIP", "PLACE_BLUE_CHIP", "GRAP_RED_CHIP", "PLACE_RED_CHIP", "CLEAN_UP"];

const flag = (byte: number, bit: number) => ({ symbol: `_IPLC[${Math.floor(byte / 4) + 1}]`, bit: (byte % 4) * 8 + bit });

const ITEMS: TelemetryItem[] = [
    { id: "user_level", group: "Steuerung", label: "Benutzerlevel", symbol: "_SSTATUS_TEXT[2]", kind: "text" },
    { id: "override_auto", group: "Steuerung", label: "Override Automatik", symbol: "_IAUTO_OVER", kind: "number", unit: "%", // 0 % is reported as "Roboter kann fahren" in controllerValues()
      alarmValues: Array.from({ length: MIN_AUTO_OVERRIDE - 1 }, (_, i) => i + 1), severity: "warning", alarmText: "Override Automatik nur {value} %" },
    { id: "override_manual", group: "Steuerung", label: "Override Hand", symbol: "_IMAN_OVER", kind: "number", unit: "%" },
    { id: "brakes", group: "Steuerung", label: "Status Bremsen", symbol: "_ISTATUS_OF_BRAKES", kind: "bits" },
    { id: "safety_controller", group: "Steuerung", label: "Safety-Controller Status", symbol: "_ISC_STATUS_INTERN", kind: "bits" },
    { id: "ups", group: "Steuerung", label: "USV-Status", symbol: "_IUPS_STATUS", kind: "bits" },

    { id: "program_running_flag", group: "Programm", label: "Interpreter aktiv (M935.6)", ...flag(935, 6), kind: "flag" },
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
    // current limits of the drives, compared with the actual current in motorCurrentValue()
    ...[1, 2, 3, 4, 5, 6].flatMap((axis): TelemetryItem[] => [
        { id: `current_max_p_${axis}`, group: "Grenzwerte", label: `Max. Strom + Achse ${axis}`, symbol: `_RCURR_MAX_P[${axis}]`, kind: "number" },
        { id: `current_max_n_${axis}`, group: "Grenzwerte", label: `Max. Strom - Achse ${axis}`, symbol: `_RCURR_MAX_N[${axis}]`, kind: "number" },
    ]),
    { id: "overload", group: "Störungen", label: "Überlasterkennung", symbol: "_IOVERLOAD_DETECT", kind: "number", alarmWhenNotZero: true, severity: "warning", okText: "keine Überlast", alarmText: "Überlasterkennung meldet {value}", note: "_IOVERLOAD_DETECT, Bedeutung der Werte nicht dokumentiert" },

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
        updateStartLock();
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

    const controller = await readControllerState();
    values = [
        ...controllerValues(controller, Number(raw["_IAUTO_OVER"])),
        ...ITEMS.filter((item) => item.group !== "Grenzwerte")
            .map((item) => toValue(item, item.symbol in raw ? raw[item.symbol] : undefined))
            .map((value) => withBackendChipCount(value))
            .map((value) => withMessageText(value)),
        motorCurrentValue(raw),
        gameStateWatchdogValue(),
    ];
    updatedAt = new Date().toISOString();
    checkActionAtStartup(raw["I_Aktion"]);
    reportAlarms();
    updateFaultMemory();
    updateStartLock();
    sendStateToControlPanelClient?.();
}

// ---------------------------------------------------------------------------------------------
// Robot readiness: the game needs drives on, AUTO mode, the game program running and override > 0

let readiness: { ready: boolean, reasons: string[] } = { ready: false, reasons: ["Noch keine Werte von der Steuerung"] };

export function getRobotReadiness() {
    if (RV6L_STATE.mock) return { ready: true, reasons: [] };
    if (!RV6L_STATE.rv6l_connected) return { ready: false, reasons: ["Keine Verbindung zur Robotersteuerung"] };
    return readiness;
}

const isGameRunning = () => !["IDLE", "ERROR"].includes(state.stateName);

function controllerValues(controller: ControllerState, autoOverride: number): TelemetryValue[] {
    // not ready is a fault that stops the game while one is running, otherwise a warning that blocks the start
    const during = isGameRunning();
    const status = (id: string, label: string, available: boolean, ok: boolean, okText: string, alarmText: string, note?: string): TelemetryValue => ({
        id, group: "Steuerung", label, symbol: "", kind: "text", note,
        available, value: ok ? okText : alarmText, alarm: available && !ok, okText, alarmText,
        severity: during ? "fatal" : "warning", critical: during,
    });

    const mode = controller.runMode ?? "";
    // the pendant reports e.g. Test_1 or Test_3; AUTO has not been seen on this robot yet, match it loosely
    const auto = /auto/i.test(mode);
    const program = controller.interpreter?.filename ?? "";
    const programName = program.split("/").pop() ?? program;
    const rightProgram = program.toUpperCase() === GAME_PROGRAM;
    const running = controller.interpreter?.state === "active";

    const values = [
        status("drives_state", "Antriebe", controller.drives !== null, controller.drives === "On", "ein", "Antriebe aus"),
        status("run_mode", "Betriebsart", controller.runMode !== null, auto, mode,
            `Betriebsart ${mode}, das Spiel braucht AUTO`, "Nur in AUTO nimmt die Steuerung Befehle vom Backend an"),
        status("game_program", "Spielprogramm", controller.interpreter !== null, rightProgram && running,
            `${programName} läuft`,
            !rightProgram ? `Falsches Programm angewählt: ${programName || "keins"}` : `${programName} läuft nicht (Interpreter ${controller.interpreter?.state})`,
            `Erwartet: ${GAME_PROGRAM}`),
        status("override_zero", "Roboter kann fahren", !Number.isNaN(autoOverride), autoOverride > 0, "Override > 0 %",
            "Override Automatik steht auf 0 %, der Roboter fährt nicht"),
    ];
    readiness = {
        ready: values.every((v) => v.available && !v.alarm),
        reasons: values.filter((v) => !v.available || v.alarm).map((v) => v.available ? v.alarmText! : `${v.label} unbekannt`),
    };
    return values;
}

setRobotReadyCheck(() => getRobotReadiness().ready);

// ---------------------------------------------------------------------------------------------
// Motor currents close to the drive limits

function motorCurrentValue(raw: Record<string, string>): TelemetryValue {
    const high: string[] = [];
    let available = false;
    for (let axis = 1; axis <= 6; axis++) {
        const current = Number(raw[`_RCURR_ACT[${axis}]`]);
        const limit = Math.min(Math.abs(Number(raw[`_RCURR_MAX_P[${axis}]`])), Math.abs(Number(raw[`_RCURR_MAX_N[${axis}]`])));
        if (Number.isNaN(current) || !limit) continue;
        available = true;
        const share = Math.abs(current) / limit;
        if (share > CURRENT_WARNING_SHARE) high.push(`Achse ${axis} bei ${Math.round(share * 100)} %`);
    }
    const alarmText = `Motorstrom nahe am Maximum: ${high.join(", ")}`;
    return {
        id: "motor_current", group: "Störungen", label: "Motorströme", symbol: "_RCURR_ACT", kind: "text",
        available, value: high.length ? alarmText : "im normalen Bereich", alarm: high.length > 0,
        okText: "im normalen Bereich", alarmText, severity: "warning",
        note: `Warnung ab ${CURRENT_WARNING_SHARE * 100} % von _RCURR_MAX_P/N`,
    };
}

// ---------------------------------------------------------------------------------------------
// A robot state that takes much longer than expected means the robot or the game is stuck

function gameStateWatchdogValue(): TelemetryValue {
    const current = GameManager.currentGameState;
    const elapsed = current.startTime ? Date.now() - new Date(current.startTime).getTime() : 0;
    const limit = (current.expectedDuration ?? Infinity) * 1.5;
    const overdue = MOVING_STATES.includes(current.stateName) && elapsed > limit;
    const alarmText = `${current.stateName} dauert ungewöhnlich lange (${Math.round(elapsed / 1000)} s)`;
    return {
        id: "state_watchdog", group: "Störungen", label: "Spielablauf", symbol: "", kind: "text",
        available: true, value: overdue ? alarmText : "im Zeitplan", alarm: overdue,
        okText: "im Zeitplan", alarmText, severity: "warning",
    };
}

// ---------------------------------------------------------------------------------------------
// After a restart of the backend the robot may still be in the middle of an action

let startupChecked = false;

function checkActionAtStartup(action: string | undefined) {
    if (startupChecked || action === undefined) return;
    startupChecked = true;
    if (String(action) !== "0") {
        recordEvent("rv6l:action_at_startup", {
            title: `Beim Start des Backends war am Roboter noch Aktion ${action} aktiv`,
            severity: "fatal", critical: true, source: "Robotersteuerung",
            details: "Das Backend wurde vermutlich während einer Bewegung neu gestartet. Stellung, Sauger und Spielfeld prüfen.",
        });
    }
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

// These faults block new games until they are acknowledged in the fault memory
const CRITICAL_ITEMS = new Set([
    "collective_fault", "compressed_air", "safety_controller_error", "collision",
    "collision_axis_1", "collision_axis_2", "collision_axis_3", "collision_axis_4", "collision_axis_5", "collision_axis_6",
    "pallet_blue", "pallet_red",
]);
let storedMessageKeys = new Set<string>();

function updateFaultMemory() {
    for (const value of values) {
        // messages of the controller are stored per message number below
        if (!value.severity || !value.available || value.group === "Meldung") continue;
        updateCondition(`telemetry:${value.id}`, value.alarm, {
            title: value.alarmText ?? value.label,
            severity: value.severity,
            critical: value.critical ?? CRITICAL_ITEMS.has(value.id),
            source: "Robotersteuerung",
            details: value.note,
        });
    }

    const current = new Set<string>();
    for (const message of getMessages()) {
        const key = `message:S${message.number}`;
        current.add(key);
        updateCondition(key, true, {
            title: `S${message.number}${message.reference ? `: ${message.reference.message}` : ""}`,
            severity: message.level === "Error" ? "fatal" : "warning",
            // errors shown on the pendant stop the robot; information like S84 does not
            critical: message.level === "Error",
            source: "Meldung der Steuerung",
            details: message.reference ? `Ursache: ${message.reference.cause} Abhilfe: ${message.reference.remedy}` : undefined,
        });
    }
    for (const key of storedMessageKeys) {
        if (!current.has(key)) updateCondition(key, false, { title: key, severity: "warning", critical: false, source: "Meldung der Steuerung" });
    }
    storedMessageKeys = current;
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

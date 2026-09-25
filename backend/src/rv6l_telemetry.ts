import { getSymbolList, readControllerState, readSymbol, readSymbols, RV6L_STATE, type ControllerState, type SymbolListType } from "./rv6l_client.ts";
import { ErrorType, logEvent } from "./errorHandler/error_handler.ts";
import { sendStateToControlPanelClient } from "./internal_server.ts";
import { lookupRsvError, type RsvError } from "./rsv_errors.ts";
import { getLogbookSince } from "./rv6l_monitor.ts";
import { recordEvent, updateCondition, updateLock } from "./fault_memory.ts";
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
    // overrides the static list of critical items
    critical?: boolean,
    position?: { x: number, y: number, z: number, axes: number[] },
};

const POLL_INTERVAL_MS = 1000;
// warn when a motor draws more than this share of its maximum current
const CURRENT_WARNING_SHARE = 0.9;
// the game only works with this program running in the interpreter
const GAME_PROGRAM = (process.env.ROBOT_PROGRAM || "S:/PROG/4GEWINNT/AKTUELL/4GEWINNT.MPR").toUpperCase();
// Subprograms called by the game program (U_PROG in robot-program/4GEWINNT/4GEWINNT.MPR). The interpreter
// reports the file it is executing, so while one of these runs it shows e.g. CHIP_IN_SCHACHT.SPR
const GAME_SUBPROGRAMS = ["BLAU_GREIFEN", "ROT_GREIFEN", "FELDENTNAHME", "CHIP_IN_SCHACHT", "BLAU_ABLEGEN", "ROT_ABLEGEN"];
// game states in which the robot moves; a much longer duration than expected means it is stuck
const MOVING_STATES = ["GRAP_BLUE_CHIP", "PLACE_BLUE_CHIP", "GRAP_RED_CHIP", "PLACE_RED_CHIP", "CLEAN_UP"];

const flag = (byte: number, bit: number) => ({ symbol: `_IPLC[${Math.floor(byte / 4) + 1}]`, bit: (byte % 4) * 8 + bit });

const ITEMS: TelemetryItem[] = [
    { id: "user_level", group: "Steuerung", label: "Benutzerlevel", symbol: "_SSTATUS_TEXT[2]", kind: "text" },
    // _IAUTO_OVER stays 0 in AUTO, so it is not the override. _ROVERRIDE_VALUE[1] changes with the override on
    // the pendant (e.g. 34 % logged at a stop), but this is not confirmed yet, so it is shown without a check
    { id: "override", group: "Steuerung", label: "Override", symbol: "_ROVERRIDE_VALUE[1]", kind: "number", unit: "%", note: "vermutlich der aktuelle Override, noch nicht bestätigt" },
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
    { id: "safety_controller_error", group: "Störungen", label: "Safety-Controller", symbol: "_ISC_ERROR[1]", kind: "number", alarmWhenNotZero: true, severity: "fatal", okText: "kein Fehler", alarmText: "Safety-Controller meldet Fehler {value}" },
    { id: "collision", group: "Störungen", label: "Kollision", ...flag(970, 3), kind: "flag", alarmWhen: 1, severity: "fatal", okText: "keine", alarmText: "Kollision erkannt", note: "Merker M970.3" },
    ...[1, 2, 3, 4, 5, 6].map((axis): TelemetryItem => ({
        id: `collision_axis_${axis}`, group: "Störungen", label: `Kollision Achse ${axis}`,
        ...flag(1592, axis - 1), kind: "flag", alarmWhen: 1, severity: "fatal", okText: "keine", alarmText: `Kollision an Achse ${axis}`,
        note: `Merker M1592.${axis - 1}`,
    })),
    { id: "collision_detection", group: "Störungen", label: "Kollisionserkennung", ...flag(970, 2), kind: "flag", alarmWhen: 0, severity: "warning", okText: "eingeschaltet", alarmText: "Kollisionserkennung ist ausgeschaltet", note: "Merker M970.2" },


    { id: "position", group: "Bewegung", label: "Istposition (_PACTPOS)", symbol: "_PACTPOS", kind: "position" },
    ...[1, 2, 3, 4, 5, 6].map((axis): TelemetryItem => ({
        id: `speed_axis_${axis}`, group: "Bewegung", label: `Geschwindigkeit Achse ${axis}`, symbol: `_RACTUAL_SPEED[${axis}]`, kind: "number",
    })),
    ...[1, 2, 3, 4, 5, 6].map((axis): TelemetryItem => ({
        id: `current_axis_${axis}`, group: "Bewegung", label: `Motorstrom Achse ${axis}`, symbol: `_RCURR_ACT[${axis}]`, kind: "number",
    })),
    // maximum current of the drives, compared with the actual current in motorCurrentValue();
    // _RCURR_MAX_P/N are measured peaks, not limits
    ...[1, 2, 3, 4, 5, 6].map((axis): TelemetryItem => (
        { id: `current_limit_${axis}`, group: "Grenzwerte", label: `Maximalstrom Achse ${axis}`, symbol: `_RCURRENT_MAX[${axis}]`, kind: "number" })),
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

// ---------------------------------------------------------------------------------------------
// Messages of the controller, followed in its logbook. _IACT_ERROR and _IDISP_ERROR only hold the last
// message and keep it after it was acknowledged, so they cannot tell whether a message is still pending.
// In the logbook every message is an entry, and acknowledging it at the pendant writes a "message ack".

type PendingMessage = { number: number, level: string, parameters: string[], date: string };

// informational messages worth keeping in the fault memory; others like the axis dumps S101 are noise
const STORED_INFORMATION = [84, 85];
const LOGBOOK_INTERVAL_MS = 2000;

let logbookSize: number | null = null;
let lastLogbookCheck = 0;
let pendingMessages: PendingMessage[] = [];

async function followLogbook() {
    if (Date.now() - lastLogbookCheck < LOGBOOK_INTERVAL_MS) return;
    lastLogbookCheck = Date.now();
    const firstRun = logbookSize === null;
    const { size, entries } = await getLogbookSince(logbookSize);
    logbookSize = size;
    for (const entry of entries) {
        if (entry.type === "Quittierung") {
            pendingMessages = [];
            continue;
        }
        if (entry.type !== "Meldung") continue;
        const level = entry.level ?? "";
        if (/error|warn/i.test(level)) {
            pendingMessages = [...pendingMessages.filter((m) => m.number !== entry.number),
                { number: entry.number, level, parameters: entry.parameters, date: entry.date }];
        } else if (!firstRun && STORED_INFORMATION.includes(entry.number)) {
            const reference = lookupRsvError(entry.number, entry.parameters);
            recordEvent(`message:S${entry.number}`, {
                title: `S${entry.number}${reference ? `: ${reference.message}` : ""}`,
                severity: "warning", critical: false, source: "Meldung der Steuerung",
                details: reference?.cause ? `Ursache: ${reference.cause} Abhilfe: ${reference.remedy}` : undefined,
            });
        }
    }
}

// newest first, like the pendant shows them
function getMessages(): ControllerMessage[] {
    return [...pendingMessages].reverse().map((m, i) => ({
        number: m.number,
        source: i === 0 ? "displayed" : "active",
        level: /error/i.test(m.level) ? "Error" : "Warning",
        reference: lookupRsvError(m.number, m.parameters),
    }));
}

// The pressure switch input is set in the machine data IBIN_FUNC_IN[1], which cannot be read via the
// interface, so missing air is detected by the controller's message S19
function compressedAirValue(): TelemetryValue {
    const missing = pendingMessages.some((m) => m.number === 19);
    return {
        id: "compressed_air", group: "Störungen", label: "Druckluft", symbol: "", kind: "text",
        available: logbookSize !== null, value: missing ? "fehlt" : "in Ordnung", alarm: missing,
        okText: "in Ordnung", alarmText: "Druckluft fehlt (Meldung S19)", severity: "fatal",
        note: "Erkannt über Meldung S19 der Steuerung",
    };
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
        updateLock();
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

    await followLogbook().catch((error) => {
        if (String(error) !== lastPollError) console.log(`Logbook could not be read: ${error}`);
    });
    const controller = await readControllerState();
    values = [
        ...controllerValues(controller, programStarted(raw)),
        ...ITEMS.filter((item) => item.group !== "Grenzwerte")
            .map((item) => toValue(item, item.symbol in raw ? raw[item.symbol] : undefined))
            .map((value) => withBackendChipCount(value)),
        compressedAirValue(),
        motorCurrentValue(raw),
        gameStateWatchdogValue(),
    ];
    updatedAt = new Date().toISOString();
    checkActionAtStartup(raw["I_Aktion"]);
    reportAlarms();
    updateFaultMemory();
    updateLock();
    sendStateToControlPanelClient?.();
}

// ---------------------------------------------------------------------------------------------
// Robot readiness: the game needs drives on, AUTO mode and the game program running

// M935.6 stays set while a program is started, also while it pauses between steps in T1 (the task state
// of the interpreter flips between active and inactive there), so it tells whether the program runs
function programStarted(raw: Record<string, string>): boolean | null {
    const { symbol, bit } = flag(935, 6);
    return symbol in raw ? ((Number(raw[symbol]) >>> bit) & 1) === 1 : null;
}

function controllerValues(controller: ControllerState, started: boolean | null): TelemetryValue[] {
    // everything that prevents a game is a critical fault: it locks the game in ERROR until it is gone and acknowledged
    const status = (id: string, label: string, available: boolean, ok: boolean, okText: string, alarmText: string, note?: string): TelemetryValue => ({
        id, group: "Steuerung", label, symbol: "", kind: "text", note,
        available, value: ok ? okText : alarmText, alarm: available && !ok, okText, alarmText,
        severity: "fatal", critical: true,
    });

    const mode = controller.runMode ?? "";
    // the pendant reports e.g. Test_1 or Test_3; AUTO has not been seen on this robot yet, match it loosely
    const auto = /auto/i.test(mode);
    const program = controller.interpreter?.filename ?? "";
    const programName = program.split("/").pop() ?? program;
    const rightProgram = isGameProgramFile(program);
    const running = started ?? controller.interpreter?.state === "active";

    const values = [
        status("drives_state", "Antriebe", controller.drives !== null, controller.drives === "On", "ein", "Antriebe aus"),
        status("run_mode", "Betriebsart", controller.runMode !== null, auto, mode,
            `Betriebsart ${mode}, das Spiel braucht AUTO`, "Nur in AUTO nimmt die Steuerung Befehle vom Backend an"),
        status("game_program", "Spielprogramm", controller.interpreter !== null, rightProgram && running,
            `${programName} läuft`,
            !rightProgram ? `Falsches Programm angewählt: ${programName || "keins"}`
                : `${programName} ist angehalten${controller.interpreter?.step ? ` (Zeile ${controller.interpreter.step})` : ""}`,
            `Erwartet: ${GAME_PROGRAM}`),
    ];
    return values;
}

// Between two commands the interpreter always waits in the main program, so the last main program (.MPR)
// seen tells whether a running subprogram belongs to the game or e.g. to the test sequence
let lastMainProgram = "";

function isGameProgramFile(filename: string) {
    const file = filename.toUpperCase();
    if (file.endsWith(".MPR")) lastMainProgram = file;
    if (file === GAME_PROGRAM) return true;
    const folder = GAME_PROGRAM.slice(0, GAME_PROGRAM.lastIndexOf("/") + 1);
    const name = file.slice(folder.length).replace(/\.SPR$/, "");
    const isSubprogram = file.startsWith(folder) && file.endsWith(".SPR") && GAME_SUBPROGRAMS.includes(name);
    // right after a backend start the main program may not have been seen yet
    return isSubprogram && (lastMainProgram === "" || lastMainProgram === GAME_PROGRAM);
}



// ---------------------------------------------------------------------------------------------
// Motor currents close to the drive limits

function motorCurrentValue(raw: Record<string, string>): TelemetryValue {
    const high: string[] = [];
    let available = false;
    for (let axis = 1; axis <= 6; axis++) {
        const current = Number(raw[`_RCURR_ACT[${axis}]`]);
        const limit = Math.abs(Number(raw[`_RCURRENT_MAX[${axis}]`]));
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
        note: `Warnung ab ${CURRENT_WARNING_SHARE * 100} % von _RCURRENT_MAX`,
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
    const pallets: Record<string, { color: string, key: "blueChipsLeft" | "redChipsLeft" }> = {
        pallet_blue: { color: "blau", key: "blueChipsLeft" },
        pallet_red: { color: "rot", key: "redChipsLeft" },
    };
    const pallet = pallets[value.id];
    if (!pallet || !value.available) return value;
    // the controller's counter is the truth; while the backend is not moving the robot, a change comes from
    // the pendant (e.g. chips taken by hand or with a test sequence), so the backend just takes it over
    const controllerCount = Number(value.value);
    if (!RV6L_STATE.rv6l_moving && RV6L_STATE[pallet.key] !== controllerCount) {
        logEvent({
            errorType: ErrorType.INFO,
            description: `Palette ${pallet.color} an der Steuerung verändert, Zähler ${RV6L_STATE[pallet.key]} → ${controllerCount} übernommen`,
            date: new Date().toString()
        });
        RV6L_STATE[pallet.key] = controllerCount;
    }
    return value;
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
    for (const message of getMessages().filter((m) => !STORED_INFORMATION.includes(m.number))) {
        const key = `message:S${message.number}`;
        current.add(key);
        updateCondition(key, true, {
            title: `S${message.number}${message.reference ? `: ${message.reference.message}` : ""}`,
            severity: message.level === "Error" ? "fatal" : "warning",
            // errors shown on the pendant stop the robot; information like S84 does not
            critical: message.level === "Error",
            source: "Meldung der Steuerung",
            details: message.reference?.cause ? `Ursache: ${message.reference.cause} Abhilfe: ${message.reference.remedy}` : undefined,
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

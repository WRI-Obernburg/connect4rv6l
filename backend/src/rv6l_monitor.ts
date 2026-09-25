import { XMLParser } from "fast-xml-parser";
import { readSymbol, sendMonitorCommand } from "./rv6l_client.ts";
import { lookupRsvError } from "./rsv_errors.ts";

/**
 * Read only monitoring for the "Roboter-Monitor" page of the control panel: tasks of the controller,
 * the source of the running program, the controller logbook and version information.
 * The page requests this only while it is open, so it adds no load otherwise.
 */

// keep attributes, e.g. the type of a logbook entry
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", parseTagValue: false, trimValues: true });

const asArray = <T>(value: T | T[] | undefined): T[] => value === undefined ? [] : Array.isArray(value) ? value : [value];
const text = (value: any): string => value === undefined || value === null ? "" : typeof value === "object" ? String(value["#text"] ?? "") : String(value);
const reply = (xml: string, api: string, command: string) => parser.parse(xml)?.RSVRES?.[api]?.[command];

// ---------------------------------------------------------------------------------------------
// Tasks

export const TASKS = ["Interpreter", "Executor", "ParallelExecutor", "StatusExecutor"];

export type TaskState = { name: string, state?: string, filename?: string, step?: number, error?: string };

export async function getTasks(): Promise<TaskState[]> {
    const result: TaskState[] = [];
    for (const name of TASKS) {
        try {
            const node = reply(await sendMonitorCommand(`<phgApi><getTaskState><task>${name}</task></getTaskState></phgApi>`), "phgApi", "getTaskState");
            result.push({ name, state: text(node?.state), filename: text(node?.filename), step: Number(text(node?.step)) || undefined });
        } catch (error) {
            result.push({ name, error: String(error) });
        }
    }
    return result;
}

/** Whether the robot is referenced (axes coincident); without it no program may run. */
export async function getCoincidence(): Promise<string> {
    try {
        return text(reply(await sendMonitorCommand("<phgApi><getCoincidenceState/></phgApi>"), "phgApi", "getCoincidenceState"));
    } catch (error) {
        return `nicht verfügbar (${error})`;
    }
}

// ---------------------------------------------------------------------------------------------
// Program source for the interpreter view; programs change rarely, so they are cached

const programCache = new Map<string, { source: string, fetchedAt: number }>();
const PROGRAM_CACHE_MS = 5 * 60 * 1000;

export async function getProgramSource(filename: string, refresh = false): Promise<string> {
    if (!/^[A-Z]:\/[\w\/$.-]+$/i.test(filename)) throw new Error(`Invalid program name ${filename}`);
    const cached = programCache.get(filename);
    if (!refresh && cached && Date.now() - cached.fetchedAt < PROGRAM_CACHE_MS) return cached.source;

    // task states use "S:/PROG/X.MPR", getProg takes the path without extension
    const name = filename.replace(/\.(MPR|SPR)$/i, "");
    const node = reply(await sendMonitorCommand(`<awpApi><getProg><name>${name}</name><src/></getProg></awpApi>`, 60000), "awpApi", "getProg");
    const base64 = text(node?.src).replace(/\s/g, "");
    if (!base64) throw new Error("Die Steuerung hat keinen Programmtext geliefert");
    const source = decodeCp850(Buffer.from(base64, "base64"));
    programCache.set(filename, { source, fetchedAt: Date.now() });
    return source;
}

// The controller stores programs in the DOS code page 850 ("Ü" is 0x9A), not in Latin-1
const CP850_HIGH = "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´\u00AD±‗¾¶§÷¸°¨·¹³²■\u00A0";

export function decodeCp850(bytes: Buffer): string {
    let result = "";
    for (const byte of bytes) result += byte < 0x80 ? String.fromCharCode(byte) : CP850_HIGH[byte - 0x80];
    return result;
}

// ---------------------------------------------------------------------------------------------
// Logbook of the controller: commands, program events, operating mode changes and messages

const ENTRY_TYPES: Record<string, string> = {
    "logbook command": "Befehl",
    "logbook program": "Programm",
    "logbook operation mode": "Betriebsart",
    "logbook usv": "USV",
    "logbook progsys": "Programmsystem",
    "message": "Meldung",
};

export type LogbookEntry = {
    index: number,
    date: string,
    type: string,
    key: string,
    number: number,
    level?: string,
    source?: string,
    parameters: string[],
    text?: string,
    related: { type: string, key: string, parameters: string[], text?: string }[],
};

function toEntry(journal: any, index: number): LogbookEntry {
    const parameters = asArray(journal?.Parameters?.Parameter).map(text);
    const number = Number(text(journal?.Number));
    const type = String(journal?.["@type"] ?? "");
    const isMessage = type === "message" || /^M\d+$/.test(text(journal?.Key));
    return {
        index,
        date: text(journal?.Date),
        type: ENTRY_TYPES[type] ?? type,
        key: text(journal?.Key),
        number,
        level: text(journal?.Level) || undefined,
        source: text(journal?.Source) || undefined,
        parameters,
        // messages share their numbers with the S codes of the Reis error list
        text: isMessage ? lookupRsvError(number)?.message : undefined,
        related: asArray(journal?.ChainList?.Journal).map((child: any) => {
            const childType = String(child?.["@type"] ?? "");
            return {
                type: ENTRY_TYPES[childType] ?? childType,
                key: text(child?.Key),
                parameters: asArray(child?.Parameters?.Parameter).map(text),
                text: childType === "message" ? lookupRsvError(Number(text(child?.Number)))?.message : undefined,
            };
        }),
    };
}

const ACCEPT_ALL = '<filter policy="accept"></filter>';

/** The newest entries of the logbook; `before` pages further back. */
export async function getLogbook(count: number, before?: number): Promise<{ size: number, entries: LogbookEntry[] }> {
    const sizeNode = reply(await sendMonitorCommand(`<lgbApi><getLogbookSize>${ACCEPT_ALL}</getLogbookSize></lgbApi>`), "lgbApi", "getLogbookSize");
    const size = Number(text(sizeNode?.size)) || 0;
    const end = Math.min(before ?? size, size);
    const begin = Math.max(0, end - Math.min(Math.max(count, 1), 200));
    if (end <= begin) return { size, entries: [] };
    const node = reply(await sendMonitorCommand(`<lgbApi><getLogbookEntries><begin>${begin}</begin><end>${end}</end>${ACCEPT_ALL}</getLogbookEntries></lgbApi>`, 60000),
        "lgbApi", "getLogbookEntries");
    const entries = asArray(node?.entries?.Journal).map((journal, i) => toEntry(journal, begin + i));
    return { size, entries: entries.reverse() };
}

// ---------------------------------------------------------------------------------------------
// System information: robot, project and the version tree of the controller

export type InfoRow = { section: string, label: string, value: string };

let systemCache: { rows: InfoRow[], fetchedAt: number } | null = null;

export async function getSystemInfo(): Promise<InfoRow[]> {
    if (systemCache && Date.now() - systemCache.fetchedAt < 5 * 60 * 1000) return systemCache.rows;
    const rows: InfoRow[] = [];
    const tryAdd = async (section: string, label: string, body: string, api: string, command: string, pick: (node: any) => string) => {
        try {
            rows.push({ section, label, value: pick(reply(await sendMonitorCommand(body), api, command)) });
        } catch (error) {
            rows.push({ section, label, value: `nicht verfügbar (${error})` });
        }
    };
    await tryAdd("Roboter", "Name", "<phgApi><getRobotName></getRobotName></phgApi>", "phgApi", "getRobotName", (n) => text(n?.robotName));
    await tryAdd("Roboter", "Aktives Projekt", "<projectApi><getActiveProjectName/></projectApi>", "projectApi", "getActiveProjectName", (n) => text(n));
    await tryAdd("Roboter", "Referenziert", "<phgApi><getCoincidenceState/></phgApi>", "phgApi", "getCoincidenceState",
        (n) => text(n) === "coincident" ? "ja" : text(n) === "notCoincident" ? "nein, Achsen nicht referenziert" : text(n));
    try {
        const version = reply(await sendMonitorCommand("<awpApi><getVersionInformation></getVersionInformation></awpApi>"), "awpApi", "getVersionInformation");
        flattenVersion(version, [], rows);
        // some entries only name a system variable, e.g. "_ISYS_LOAD[3] %" for the current load
        for (const row of rows) {
            const symbol = /^(_[A-Z][A-Z0-9_]*\[\d+\])(.*)$/.exec(row.value);
            if (!symbol?.[1]) continue;
            try {
                row.value = `${Number(await readSymbol(symbol[1])).toLocaleString("de-DE")}${symbol[2] ?? ""}`;
            } catch {
                // keep the symbol name if the controller does not know it
            }
        }
    } catch (error) {
        rows.push({ section: "Version", label: "Versionsinformation", value: `nicht verfügbar (${error})` });
    }
    systemCache = { rows, fetchedAt: Date.now() };
    return rows;
}

// Turns <Software><RobotStar><Version descriptor="...">31.0.9</Version>... into rows grouped by the top level
function flattenVersion(node: any, path: string[], rows: InfoRow[]) {
    if (node === null || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node)) {
        if (key.startsWith("@") || key === "#text") continue;
        for (const item of asArray(value as any)) {
            const leaf = typeof item !== "object" || item === null || "#text" in item && Object.keys(item).every((k) => k === "#text" || k.startsWith("@"));
            if (leaf) {
                const label = (typeof item === "object" && item?.["@descriptor"]) || [...path.slice(1), key].join(" ");
                const unit = typeof item === "object" && item?.["@unit"] ? ` ${item["@unit"]}` : "";
                rows.push({ section: path[0] ?? key, label, value: text(item) + unit });
            } else {
                flattenVersion(item, [...path, key], rows);
            }
        }
    }
}
